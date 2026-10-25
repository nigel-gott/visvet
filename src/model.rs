//! Builds the `Review`: code units and members diffed against `base`, plus the dependencies between them.
use crate::extract::extract;
use crate::{codegen, git};
use crate::types::{BoxId, ChangeStatus, CodeUnit, Dependency, DependencyKind, DiffLine, DiffLineKind, GitRef, LineRange, Member, MemberId, MemberKind, Review, RepoPath, TraitRef, UnitId, UnitKind};
use similar::{ChangeTag, TextDiff};
use std::collections::{BTreeSet, HashMap, HashSet};
use std::path::Path;

/// Builds the `Review` for `repo_root`: the working tree compared against git ref `base`.
/// Leaves `annotations` empty; the caller fills it from the store.
pub fn build_review(repo_root: &Path, base: &str) -> anyhow::Result<Review> {
    let cur: HashSet<String> = git::current_files(repo_root)?.into_iter().collect();
    let old: HashSet<String> = git::base_files(repo_root, base)?.into_iter().collect();
    let diffs: Option<HashSet<String>> = git::changed(repo_root, base).map(HashSet::from_iter);
    let mut all = vec![];
    for f in cur.union(&old).collect::<BTreeSet<_>>() {
        let new = cur.contains(f).then(|| std::fs::read(repo_root.join(f)).ok()).flatten();
        let same = diffs.as_ref().is_some_and(|d| !d.contains(f));
        let prev = if !old.contains(f) { None } else if same { new.clone() } else { git::show(repo_root, base, f) };
        all.extend(file_objects(f, new.as_deref(), prev.as_deref()));
    }
    let (units, dependencies) = link(all, &cur);
    Ok(Review { compared_against: GitRef(base.into()), units, dependencies, ..Default::default() })
}

/// A code unit as parsed, with the names it mentions before they are resolved into dependencies:
/// type names it uses outside any member (a type alias, a tuple struct), type names per member as
/// `(member id, kind, names)`, traits it implements, candidate files per import, and calls or
/// constructions as `[from member id, qualifier, name]`, and the ids of the types a code generator writes from it.
struct Parsed {
    unit: CodeUnit,
    types: Vec<String>,
    member_types: Vec<(String, MemberKind, Vec<String>)>,
    traits: Vec<String>,
    imports: Vec<Vec<String>>,
    calls: Vec<[String; 3]>,
    generates: Vec<String>,
}

/// A dependency arrow.
fn dep(from: &str, to: &str, kind: DependencyKind) -> Dependency {
    Dependency { from: BoxId(from.into()), to: BoxId(to.into()), kind }
}

/// Resolves names into dependencies and each unit's `implements`, then keeps changed units plus unchanged
/// neighbors one hop away (only "has" and "implements" arrows pull them in). Removed things are never targets.
fn link(all: Vec<Parsed>, cur: &HashSet<String>) -> (Vec<CodeUnit>, Vec<Dependency>) {
    let ix = Index::new(&all);
    let (mut edges, mut links, mut implements) = (vec![], BTreeSet::new(), vec![]);
    let ids: HashSet<&str> = all.iter().map(|p| p.unit.id.as_str()).collect();
    for p in &all {
        let o = &p.unit;
        let files: BTreeSet<&String> = p.imports.iter().filter_map(|c| c.iter().find(|f| cur.contains(*f))).collect();
        edges.extend(files.into_iter().filter(|f| *f != o.id.as_str()).map(|f| dep(o.id.as_str(), f, DependencyKind::Imports)));
        for (names, kind) in [(&p.types, DependencyKind::Has), (&p.traits, DependencyKind::Implements)] {
            for to in names.iter().filter_map(|name| ix.ty(o, name)).filter(|to| *to != o.id.as_str()) {
                edges.push(dep(o.id.as_str(), to, kind));
            }
        }
        for (member, kind, names) in &p.member_types {
            // A field "has" the types it holds; a function "uses" the types its body really uses.
            let arrow = if matches!(kind, MemberKind::Field | MemberKind::Variant) { DependencyKind::Has } else { DependencyKind::Uses };
            for to in names.iter().filter_map(|name| ix.ty(o, name)).filter(|to| *to != o.id.as_str()) {
                edges.push(dep(member, to, arrow));
            }
        }
        edges.extend(p.generates.iter().filter(|to| ids.contains(to.as_str())).map(|to| dep(o.id.as_str(), to, DependencyKind::Generates)));
        implements.push(p.traits.iter().map(|name| TraitRef { name: name.clone(), unit: ix.ty(o, name).map(|id| UnitId(id.into())) }).collect());
        for [from, q, name] in &p.calls {
            let (to, kind) = if q == "new" { (ix.ty(o, name), DependencyKind::Creates) } else { (ix.callee(o, q, name).filter(|to| to != from), DependencyKind::Calls) };
            links.extend(to.map(|to| (from.as_str(), to, kind)));
        }
    }
    edges.extend(links.into_iter().map(|(from, to, kind)| dep(from, to, kind)));
    let units = all.into_iter().zip(implements).map(|(p, implements)| CodeUnit { implements, ..p.unit }).collect();
    let units = with_neighbors(units, &mut edges);
    (units, edges)
}

/// Keeps changed units plus unchanged ones a "has" or "implements" arrow away, sorted by place, and the arrows between kept ones.
fn with_neighbors(all: Vec<CodeUnit>, edges: &mut Vec<Dependency>) -> Vec<CodeUnit> {
    let changed: HashSet<String> = all.iter().filter(|o| o.status != ChangeStatus::Same).map(|o| o.id.0.clone()).collect();
    // A "has" arrow can start at a field; it counts for the field's unit.
    let unit_of: HashMap<String, String> = all.iter().flat_map(|o| o.members.iter().map(|m| (m.id.0.clone(), o.id.0.clone()))).collect();
    let unit = |id: &BoxId| unit_of.get(id.as_str()).cloned().unwrap_or_else(|| id.0.clone());
    let near: HashSet<String> = edges.iter().filter(|e| matches!(e.kind, DependencyKind::Has | DependencyKind::Implements))
        .flat_map(|e| [(unit(&e.from), unit(&e.to)), (unit(&e.to), unit(&e.from))])
        .filter(|(a, _)| changed.contains(a)).map(|(_, b)| b).collect();
    let mut units: Vec<CodeUnit> = all.into_iter().map(|mut o| {
        o.neighbor_only = !changed.contains(&o.id.0);
        o
    }).filter(|o| !o.neighbor_only || near.contains(&o.id.0)).collect();
    units.sort_by(|a, b| (&a.file, a.lines.first).cmp(&(&b.file, b.lines.first)));
    let kept: HashSet<&str> = units.iter().flat_map(|o| o.members.iter().map(|m| m.id.as_str()).chain([o.id.as_str()])).collect();
    edges.retain(|e| kept.contains(e.from.as_str()) && kept.contains(e.to.as_str()));
    units
}

/// Dependency targets by name: types (not impls or files) and fns and methods, removed ones left out.
struct Index<'a> { types: HashMap<&'a str, Vec<&'a CodeUnit>>, fns: HashMap<&'a str, Vec<(&'a CodeUnit, &'a Member)>> }

impl<'a> Index<'a> {
    /// Indexes the live types and fns of `all`.
    fn new(all: &'a [Parsed]) -> Self {
        let mut ix = Index { types: HashMap::new(), fns: HashMap::new() };
        for o in all.iter().map(|p| &p.unit).filter(|o| o.status != ChangeStatus::Removed) {
            if !matches!(o.kind, UnitKind::Impl | UnitKind::File) {
                ix.types.entry(&o.name).or_default().push(o);
            }
            for m in o.members.iter().filter(|m| matches!(m.kind, MemberKind::Fn | MemberKind::Method) && m.status != ChangeStatus::Removed) {
                ix.fns.entry(&m.name).or_default().push((o, m));
            }
        }
        ix
    }

    /// The id of the type `o` means by `name`, in `o`'s language.
    fn ty(&self, o: &CodeUnit, name: &str) -> Option<&'a str> {
        let c: Vec<_> = self.types.get(name).into_iter().flatten().filter(|c| same_lang(o, &c.file)).map(|c| (*c, c.id.as_str())).collect();
        pick(o, &c)
    }

    /// The id of the fn or method `o` calls as `q::name`: a free fn when `q` is "", else a method
    /// of unit `q` or a free fn of the file named `q`.
    fn callee(&self, o: &CodeUnit, q: &str, name: &str) -> Option<&'a str> {
        let c: Vec<_> = self.fns.get(name).into_iter().flatten().filter(|(co, cm)| same_lang(o, &co.file) && match q {
            "" => cm.kind == MemberKind::Fn,
            q => co.name == q || cm.kind == MemberKind::Fn && co.file.as_str().trim_end_matches("/mod.rs").rsplit('/').next().unwrap().split('.').next() == Some(q),
        }).map(|(co, cm)| (*co, cm.id.as_str())).collect();
        pick(o, &c)
    }
}

/// Whether `file` is in the same language family as `o`'s file: Rust or not.
fn same_lang(o: &CodeUnit, file: &RepoPath) -> bool {
    file.is_rust() == o.file.is_rust()
}

/// The only target in the first non-empty tier of candidates: same unit, same file, anywhere.
fn pick<'a>(o: &CodeUnit, c: &[(&CodeUnit, &'a str)]) -> Option<&'a str> {
    let tiers = [c.iter().filter(|(co, _)| co.id == o.id).collect::<Vec<_>>(), c.iter().filter(|(co, _)| co.file == o.file).collect(), c.iter().collect()];
    match tiers.into_iter().find(|t| !t.is_empty())?[..] {
        [&(_, to)] => Some(to),
        _ => None,
    }
}

/// The lines `text` spans when it starts on line `first`.
fn lines(first: u32, text: &str) -> LineRange {
    LineRange { first, last: first + text.lines().count().max(1) as u32 - 1 }
}

/// Objects of one file with their type refs, file uses and calls, matched by name between versions.
/// Text is UTF-8 with "\r\n" read as "\n" (else empty); the file object's status uses raw bytes.
/// Unchanged non-source files yield nothing; a new version with a syntax error removes nothing.
fn file_objects(file: &str, new: Option<&[u8]>, old: Option<&[u8]>) -> Vec<Parsed> {
    if new == old && !matches!(file.rsplit('.').next(), Some("rs" | "ts" | "tsx")) {
        return vec![];
    }
    let ex = |b: Option<&[u8]>| b.map_or(vec![], |b| extract(file, &std::str::from_utf8(b).unwrap_or("").replace("\r\n", "\n")));
    let (nx, ox) = (ex(new), (new != old).then(|| ex(old)));
    let (ox, broken) = (ox.as_ref().unwrap_or(&nx), nx.first().is_some_and(|f| f.broken));
    pair(&nx, ox, |o| &o.name).into_iter().filter(|(n, _)| n.is_some() || !broken).map(|(n, o)| {
        let x = n.or(o).unwrap();
        let id = UnitId(if x.kind == UnitKind::File { file.to_string() } else { format!("{file}::{}", x.name) });
        let ms = pair(n.map_or(&[][..], |n| &n.members[..]), o.map_or(&[][..], |o| &o.members[..]), |m| &m.name);
        let (mut calls, mut member_types) = (vec![], vec![]);
        let members: Vec<Member> = ms.into_iter().filter(|(nm, _)| nm.is_some() || !broken).map(|(nm, om)| {
            let m = nm.or(om).unwrap();
            let mid = MemberId(format!("{id}::{}", m.name));
            calls.extend(m.calls.iter().map(|(q, n)| [mid.0.clone(), q.clone(), n.clone()]));
            member_types.push((mid.0.clone(), m.kind, m.types.iter().cloned().collect()));
            Member {
                id: mid,
                name: m.name.clone(),
                kind: m.kind,
                signature: m.sig.clone(),
                doc: m.doc.clone(),
                lines: lines(m.line, &m.text),
                status: status(nm.map(|m| &m.text), om.map(|m| &m.text)),
                complexity: m.complexity,
                coverage: None,
                diff: diff(nm.map(|m| (&*m.text, m.line)), om.map(|m| (&*m.text, m.line))),
            }
        }).collect();
        let st = match status(n.map(|n| (&n.text, &n.impls)), o.map(|o| (&o.text, &o.impls))) {
            _ if x.kind == UnitKind::File => status(new, old),
            ChangeStatus::Same if members.iter().any(|m| m.status != ChangeStatus::Same) => ChangeStatus::Changed,
            st => st,
        };
        let unit = CodeUnit {
            id,
            name: x.name.clone(),
            kind: x.kind,
            file: RepoPath(file.into()),
            lines: lines(x.line, &x.text),
            doc: x.doc.clone(),
            status: st,
            neighbor_only: false,
            implements: vec![],
            coverage: None,
            members,
            diff: diff(n.map(|n| (&*n.text, n.line)), o.map(|o| (&*o.text, o.line))),
        };
        let generates = codegen::targets(file, &x.text).into_iter().map(|f| format!("{f}::{}", x.name)).collect();
        Parsed { unit, types: x.refs.iter().cloned().collect(), member_types, traits: x.impls.iter().cloned().collect(), imports: x.uses.clone(), calls, generates }
    }).collect()
}

/// Pairs items of the new and old version by `key`; new order first, then removed ones.
fn pair<'a, T>(new: &'a [T], old: &'a [T], key: fn(&T) -> &str) -> Vec<(Option<&'a T>, Option<&'a T>)> {
    let index = |xs: &'a [T]| xs.iter().map(|x| (key(x), x)).collect::<HashMap<_, _>>();
    let (ni, oi) = (index(new), index(old));
    let mut v: Vec<_> = new.iter().map(|n| (Some(n), oi.get(key(n)).copied())).collect();
    v.extend(old.iter().filter(|o| !ni.contains_key(key(o))).map(|o| (None, Some(o))));
    v
}

/// Added, removed, changed or same, from the new and old versions.
fn status<T: PartialEq>(new: Option<T>, old: Option<T>) -> ChangeStatus {
    match (new, old) {
        (Some(_), None) => ChangeStatus::Added,
        (None, _) => ChangeStatus::Removed,
        (n, o) if n == o => ChangeStatus::Same,
        _ => ChangeStatus::Changed,
    }
}

/// Line diff of `(text, first line)`; removed lines use old-file numbers, others new-file.
fn diff(new: Option<(&str, u32)>, old: Option<(&str, u32)>) -> Vec<DiffLine> {
    let ((n, nl), (o, ol)) = (new.unwrap_or_default(), old.unwrap_or_default());
    let (n, o): (Vec<&str>, Vec<&str>) = (n.lines().collect(), o.lines().collect());
    TextDiff::from_slices(&o, &n).iter_all_changes().map(|c| {
        let (kind, line) = match c.tag() {
            ChangeTag::Equal => (DiffLineKind::Context, nl as usize + c.new_index().unwrap()),
            ChangeTag::Insert => (DiffLineKind::Added, nl as usize + c.new_index().unwrap()),
            ChangeTag::Delete => (DiffLineKind::Removed, ol as usize + c.old_index().unwrap()),
        };
        DiffLine { kind, text: c.value().into(), line: line as u32 }
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use DiffLineKind as L;
    use ChangeStatus::*;

    #[test]
    fn status_and_diff() {
        let old = "struct S { a: u8 }\nimpl S {\n    fn keep(&self) {}\n    fn edit(&self) {\n        1;\n    }\n    fn gone(&self) {}\n}\nstruct Same;\n";
        let new = "struct S { a: u8 }\n\nimpl S {\n    fn keep(&self) {}\n    fn edit(&self) {\n        x?;\n    }\n    fn added(&self) {}\n}\nstruct Same;\n";
        let objs = file_objects("a.rs", Some(new.as_bytes()), Some(old.as_bytes()));
        let (f, s, same) = (&objs[0].unit, &objs[1].unit, &objs[2].unit);
        let fd: Vec<_> = f.diff.iter().filter(|d| d.kind != DiffLineKind::Context).map(|d| (d.kind, d.line)).collect();
        assert_eq!((f.id.as_str(), f.kind, f.status, f.lines.first, fd), ("a.rs", UnitKind::File, Changed, 1, vec![(L::Added, 2), (L::Removed, 5), (L::Added, 6), (L::Removed, 7), (L::Added, 8)]));
        assert_eq!((s.id.as_str(), s.status, same.status), ("a.rs::S", Changed, Same));
        let st: Vec<_> = s.members.iter().map(|m| (m.id.as_str(), m.status)).collect();
        assert_eq!(st, [("a.rs::S::a", Same), ("a.rs::S::keep", Same), ("a.rs::S::edit", Changed), ("a.rs::S::added", Added), ("a.rs::S::gone", Removed)]);
        let d: Vec<_> = s.members[2].diff.iter().map(|d| (d.kind, d.text.as_str(), d.line)).collect();
        assert_eq!(d, [(L::Context, "    fn edit(&self) {", 5), (L::Removed, "        1;", 5), (L::Added, "        x?;", 6), (L::Context, "    }", 7)]);
        assert_eq!((same.diff[0].kind, same.diff[0].line), (L::Context, 10));
        assert_eq!(s.members[4].diff[0].kind, DiffLineKind::Removed);
        // Complexity comes from the new version; closures count toward their fn.
        let rs = "fn f() { if let Some(_) = a && b || c { x?; } for _ in x {} while a {} loop {} match a { 1 => {} _ => {} } let g = || if a {}; }";
        let ts = "function f() { if (a && b || c) {} for (;;) {} for (x of a) {} while (a) {} do {} while (a); try {} catch {} switch (a) { case 1: default: } return a ?? (b ? 1 : 2) }";
        let cx = |f: &str, s: &str| file_objects(f, Some(s.as_bytes()), None)[0].unit.members[0].complexity;
        assert_eq!((s.members[0].complexity, s.members[2].complexity, cx("d.rs", rs), cx("d.ts", ts)), (1, 1, 9, 12));
        let added = file_objects("b.rs", Some(b"fn f() {}"), None);
        assert_eq!((added[0].unit.id.as_str(), added[0].unit.status, added[0].unit.members[0].id.as_str()), ("b.rs", Added, "b.rs::f"));
        let bin = file_objects("a.png", Some(&[0xff, 1]), Some(&[0xff]));
        assert_eq!((bin.len(), bin[0].unit.status, bin[0].unit.diff.len()), (1, Changed, 0));
        let toml = &file_objects("x.toml", Some(b"a = 1\nb = 2"), Some(b"a = 1"))[0].unit;
        let d: Vec<_> = toml.diff.iter().map(|d| (d.kind, d.line)).collect();
        assert_eq!((toml.status, toml.members.len(), d), (Changed, 0, vec![(L::Context, 1), (L::Added, 2)]));
        assert!(file_objects("x.md", Some(b"same"), Some(b"same")).is_empty());
        assert_eq!(file_objects("c.rs", Some(b"#[derive(Debug)]\nstruct C;"), Some(b"struct C;"))[1].unit.status, Changed);
    }

    #[test]
    fn edges_and_context() {
        let mut all = file_objects("a.rs", Some(b"struct A { b: B, c: C }\nimpl T for A {}"), Some(b"struct A { b: B }"));
        all.extend(file_objects("b.rs", Some(b"struct B;\ntrait T {}\nstruct Far { a: A }\nstruct C;"), Some(b"struct B;\ntrait T {}\nstruct Far { a: A }")));
        all.extend(file_objects("c.rs", Some(b"struct C;\nstruct Lone;"), Some(b"struct C;\nstruct Lone;")));
        let (objs, edges) = link(all, &HashSet::new());
        let o: Vec<_> = objs.iter().map(|o| (o.id.as_str(), o.neighbor_only)).collect();
        assert_eq!(o, [("a.rs", false), ("a.rs::A", false), ("b.rs", false), ("b.rs::B", true), ("b.rs::T", true), ("b.rs::Far", true), ("b.rs::C", false)]);
        let e: Vec<_> = edges.iter().map(|e| (e.from.as_str(), e.to.as_str(), e.kind.label())).collect();
        assert_eq!(e, [("a.rs::A", "b.rs::T", "implements"), ("a.rs::A::b", "b.rs::B", "has"), ("b.rs::Far::a", "a.rs::A", "has")]);
    }

    #[test]
    fn uses_edges() {
        let files = [
            ("src/main.rs", "mod git;\nuse crate::model::build;\nuse crate::missing;"),
            ("src/model.rs", "use crate::{git, types::Model};\nuse std::fmt;\nmod inner;"),
            ("src/git.rs", ""), ("src/types.rs", ""), ("src/model/inner.rs", ""),
            ("ui/src/main.tsx", "import { a } from './api';\nimport './style.css';\nexport * from '../lib';\nimport r from 'react';"),
            ("ui/src/api.ts", ""), ("ui/src/style.css", ""), ("ui/lib/index.ts", ""),
        ];
        let cur: HashSet<String> = files.iter().map(|(f, _)| f.to_string()).collect();
        let all = files.iter().flat_map(|(f, s)| file_objects(f, Some(s.as_bytes()), None)).collect();
        let (_, edges) = link(all, &cur);
        let e: Vec<_> = edges.iter().map(|e| (e.from.as_str(), e.to.as_str(), e.kind.label())).collect();
        assert_eq!(e, [
            ("src/main.rs", "src/model.rs", "imports"),
            ("src/model.rs", "src/git.rs", "imports"), ("src/model.rs", "src/types.rs", "imports"),
            ("ui/src/main.tsx", "ui/lib/index.ts", "imports"), ("ui/src/main.tsx", "ui/src/api.ts", "imports"), ("ui/src/main.tsx", "ui/src/style.css", "imports"),
        ]);
    }

    #[test]
    fn calls_edges() {
        let files = [
            ("src/git.rs", "pub fn show() {}\npub fn list() { show(); }"),
            ("src/model.rs", "struct M;\nimpl M {\n    fn new() -> Self { Self::make(); git::show(); helper(); format!(\"{}\", list()) }\n    fn make() {}\n    fn run(&self) { self.make(); M::new(); x.walk(); }\n}\nstruct W;\nimpl W { fn walk(&self) { self.walk(); } fn make(&self) { M {}; } }\nfn helper() { list(); x.make(); Self {}; W { a: 1 }; }"),
            ("ui/a.tsx", "function A() { return <B x={1} /> }\nconst B = () => { load(); return <div /> };\nclass C { go() { this.stop(); A(); } stop() { new C(); } }"),
            ("ui/b.ts", "export function load() {}"),
        ];
        let cur: HashSet<String> = files.iter().map(|(f, _)| f.to_string()).collect();
        let all = files.iter().flat_map(|(f, s)| file_objects(f, Some(s.as_bytes()), None)).collect();
        let (_, edges) = link(all, &cur);
        let e: Vec<_> = edges.iter().filter(|e| e.kind == DependencyKind::Calls).map(|e| (e.from.as_str(), e.to.as_str())).collect();
        assert_eq!(e, [
            ("src/git.rs::list", "src/git.rs::show"),
            ("src/model.rs::M::new", "src/git.rs::show"), ("src/model.rs::M::new", "src/model.rs::M::make"), ("src/model.rs::M::new", "src/model.rs::helper"),
            ("src/model.rs::M::run", "src/model.rs::M::make"), ("src/model.rs::M::run", "src/model.rs::M::new"),
            ("src/model.rs::helper", "src/git.rs::list"),
            ("ui/a.tsx::A", "ui/a.tsx::B"), ("ui/a.tsx::B", "ui/b.ts::load"), ("ui/a.tsx::C::go", "ui/a.tsx::A"), ("ui/a.tsx::C::go", "ui/a.tsx::C::stop"),
        ]);
        let made: Vec<_> = edges.iter().filter(|e| e.kind == DependencyKind::Creates).map(|e| (e.from.as_str(), e.to.as_str())).collect();
        assert_eq!(made, [("src/model.rs::W::make", "src/model.rs::M"), ("src/model.rs::helper", "src/model.rs::W"), ("ui/a.tsx::C::stop", "ui/a.tsx::C")]);
    }

    #[test]
    fn uses_type_edges() {
        let src = b"struct V;\nenum K { A }\nfn set(v: Json<V>) -> K {}\nfn put(Json(v): Json<K>) {}\nfn get() { load::<V>() }\nfn pick(k: K) { match k { K::A => V::new() } }";
        let (_, edges) = link(file_objects("a.rs", Some(src), None), &HashSet::new());
        let e: Vec<_> = edges.iter().filter(|e| e.kind == DependencyKind::Uses).map(|e| (e.from.as_str(), e.to.as_str())).collect();
        assert_eq!(e, [("a.rs::put", "a.rs::K"), ("a.rs::get", "a.rs::V"), ("a.rs::pick", "a.rs::K")]);
    }
}

//! Dependencies between boxes: turns the names each box mentions (types, calls, imports, generated copies, Markdown
//! links) into arrows to the boxes they mean, and fills in which traits each box implements.
use crate::review::compare::Parsed;
use crate::types::{BoxContent, ChangeStatus, MapId, MapBox, Dependency, DependencyKind, Member, MemberKind, RepoPath, TraitRef, BoxId, BoxKind};
use std::collections::{BTreeSet, HashMap, HashSet};

/// A dependency arrow.
fn dep(from: &str, to: &str, kind: DependencyKind) -> Dependency {
    Dependency { from: MapId(from.into()), to: MapId(to.into()), kind }
}

/// Resolves names into dependencies and each box's `implements`, and sorts the boxes by place. Every box is kept,
/// changed or not, so the map shows the whole project. Removed things are never targets.
pub fn find_dependencies(all: Vec<Parsed>, cur: &HashSet<String>) -> (Vec<MapBox>, Vec<Dependency>) {
    let ix = Index::new(&all);
    let (mut edges, mut links, mut implements) = (vec![], BTreeSet::new(), vec![]);
    let ids: HashSet<&str> = all.iter().flat_map(|p| p.map_box.members().iter().map(|m| m.id.as_str()).chain([p.map_box.id.as_str()])).collect();
    for p in &all {
        let o = &p.map_box;
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
        edges.extend(p.links.iter().filter(|to| ids.contains(to.as_str()) && *to != o.id.as_str()).collect::<BTreeSet<_>>().into_iter().map(|to| dep(o.id.as_str(), to, DependencyKind::Links)));
        edges.extend(p.generates.iter().filter(|to| ids.contains(to.as_str())).map(|to| dep(o.id.as_str(), to, DependencyKind::Generates)));
        implements.push(p.traits.iter().map(|name| TraitRef { name: name.clone(), box_id: ix.ty(o, name).map(|id| BoxId(id.into())) }).collect());
        for [from, q, name] in &p.calls {
            let (to, kind) = if q == "new" { (ix.ty(o, name), DependencyKind::Creates) } else { (ix.callee(o, q, name).filter(|to| to != from), DependencyKind::Calls) };
            links.extend(to.map(|to| (from.as_str(), to, kind)));
        }
    }
    edges.extend(links.into_iter().map(|(from, to, kind)| dep(from, to, kind)));
    let mut boxes: Vec<MapBox> = all.into_iter().zip(implements).map(|(mut p, traits)| {
        if let BoxContent::Code { implements, .. } = &mut p.map_box.content {
            *implements = traits;
        }
        p.map_box
    }).collect();
    boxes.sort_by(|a, b| (&a.file, a.lines.first).cmp(&(&b.file, b.lines.first)));
    (boxes, edges)
}

/// Dependency targets by name: types (not impls or files) and fns and methods, removed ones left out.
struct Index<'a> { types: HashMap<&'a str, Vec<&'a MapBox>>, fns: HashMap<&'a str, Vec<(&'a MapBox, &'a Member)>> }

impl<'a> Index<'a> {
    /// Indexes the live types and fns of `all`.
    fn new(all: &'a [Parsed]) -> Self {
        let mut ix = Index { types: HashMap::new(), fns: HashMap::new() };
        for o in all.iter().map(|p| &p.map_box).filter(|o| o.status != ChangeStatus::Removed) {
            if !matches!(o.kind(), BoxKind::Impl | BoxKind::File) {
                ix.types.entry(&o.name).or_default().push(o);
            }
            for m in o.members().iter().filter(|m| matches!(m.kind, MemberKind::Fn | MemberKind::Method) && m.status != ChangeStatus::Removed) {
                ix.fns.entry(&m.name).or_default().push((o, m));
            }
        }
        ix
    }

    /// The id of the type `o` means by `name`, in `o`'s language.
    fn ty(&self, o: &MapBox, name: &str) -> Option<&'a str> {
        let c: Vec<_> = self.types.get(name).into_iter().flatten().filter(|c| same_lang(o, &c.file)).map(|c| (*c, c.id.as_str())).collect();
        pick(o, &c)
    }

    /// The id of the fn or method `o` calls as `q::name`: a free fn when `q` is "", else a method
    /// of box `q` or a free fn of the file named `q`.
    fn callee(&self, o: &MapBox, q: &str, name: &str) -> Option<&'a str> {
        let c: Vec<_> = self.fns.get(name).into_iter().flatten().filter(|(co, cm)| same_lang(o, &co.file) && match q {
            "" => cm.kind == MemberKind::Fn,
            q => co.name == q || cm.kind == MemberKind::Fn && co.file.as_str().trim_end_matches("/mod.rs").rsplit('/').next().unwrap().split('.').next() == Some(q),
        }).map(|(co, cm)| (*co, cm.id.as_str())).collect();
        pick(o, &c)
    }
}

/// Whether `file` is in the same language family as `o`'s file: Rust or not.
fn same_lang(o: &MapBox, file: &RepoPath) -> bool {
    file.is_rust() == o.file.is_rust()
}

/// The only target in the first non-empty tier of candidates: same box, same file, anywhere.
fn pick<'a>(o: &MapBox, c: &[(&MapBox, &'a str)]) -> Option<&'a str> {
    let tiers = [c.iter().filter(|(co, _)| co.id == o.id).collect::<Vec<_>>(), c.iter().filter(|(co, _)| co.file == o.file).collect(), c.iter().collect()];
    match tiers.into_iter().find(|t| !t.is_empty())?[..] {
        [&(_, to)] => Some(to),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::compare::tests::cmp;

    #[test]
    fn edges_and_every_unit() {
        let mut all = cmp("a.rs", Some(b"struct A { b: B, c: C }\nimpl T for A {}"), Some(b"struct A { b: B }"));
        all.extend(cmp("b.rs", Some(b"struct B;\ntrait T {}\nstruct Far { a: A }\nstruct C;"), Some(b"struct B;\ntrait T {}\nstruct Far { a: A }")));
        all.extend(cmp("c.rs", Some(b"struct C;\nstruct Lone;"), Some(b"struct C;\nstruct Lone;")));
        let (objs, edges) = find_dependencies(all, &HashSet::new());
        // Every box is kept, changed or not, so the map always shows the whole project.
        let o: Vec<_> = objs.iter().map(|o| o.id.as_str()).collect();
        assert_eq!(o, ["a.rs", "a.rs::A", "b.rs", "b.rs::B", "b.rs::T", "b.rs::Far", "b.rs::C", "c.rs", "c.rs::C", "c.rs::Lone"]);
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
        let all = files.iter().flat_map(|(f, s)| cmp(f, Some(s.as_bytes()), None)).collect();
        let (_, edges) = find_dependencies(all, &cur);
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
        let all = files.iter().flat_map(|(f, s)| cmp(f, Some(s.as_bytes()), None)).collect();
        let (_, edges) = find_dependencies(all, &cur);
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
        let (_, edges) = find_dependencies(cmp("a.rs", Some(src), None), &HashSet::new());
        let e: Vec<_> = edges.iter().filter(|e| e.kind == DependencyKind::Uses).map(|e| (e.from.as_str(), e.to.as_str())).collect();
        assert_eq!(e, [("a.rs::put", "a.rs::K"), ("a.rs::get", "a.rs::V"), ("a.rs::pick", "a.rs::K")]);
    }
}

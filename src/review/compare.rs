//! Comparing a file's two versions: parses both, pairs old and new types and members by name, and diffs each pair,
//! so every box knows whether it was added, changed, removed or is the same.
use crate::review::parse::{ParsedMember, ParsedBox, parse};
use super::{codegen, markdown};
use crate::types::{BoxContent, ChangeStatus, MapBox, DiffLine, DiffLineKind, LineRange, Member, MemberId, MemberKind, RepoPath, BoxId, BoxKind};
use similar::{ChangeTag, TextDiff};
use std::collections::HashMap;

/// A box as parsed, with the names it mentions before they are resolved into dependencies:
/// type names it uses outside any member (a type alias, a tuple struct), type names per member as
/// `(member id, kind, names)`, traits it implements, candidate files per import, and calls or
/// constructions as `[from member id, qualifier, name]`, the ids of the types a code generator writes from it, and
/// for a Markdown file, the boxes and files it names.
pub struct Parsed {
    pub map_box: MapBox,
    pub types: Vec<String>,
    pub member_types: Vec<(String, MemberKind, Vec<String>)>,
    pub traits: Vec<String>,
    pub imports: Vec<Vec<String>>,
    pub calls: Vec<[String; 3]>,
    pub generates: Vec<String>,
    pub links: Vec<String>,
}

/// The lines `text` spans when it starts on line `first`.
fn lines(first: u32, text: &str) -> LineRange {
    LineRange { first, last: first + text.lines().count().max(1) as u32 - 1 }
}

/// Compares the two versions of `file`, its bytes now (`new`) and at the base (`old`), either missing if the file was
/// added or removed: the file's own box, then its types, each with what it mentions. Text is read as UTF-8 with
/// "\r\n" as "\n" (else empty); the file box's status uses the raw bytes, so a binary file still shows as changed.
/// While the new version has a syntax error (e.g. mid-edit), nothing in it counts as removed.
pub fn compare_file(file: &RepoPath, new: Option<&[u8]>, old: Option<&[u8]>) -> Vec<Parsed> {
    let parsed = |b: Option<&[u8]>| b.map_or(vec![], |b| parse(file.as_str(), &std::str::from_utf8(b).unwrap_or("").replace("\r\n", "\n")));
    let (now, before) = (parsed(new), (new != old).then(|| parsed(old)));
    let (before, broken) = (before.as_ref().unwrap_or(&now), now.first().is_some_and(|f| f.broken));
    pair(&now, before, |o| &o.name).into_iter().filter(|(n, _)| n.is_some() || !broken)
        .map(|(n, o)| compare_box(file, n, o, broken, status(new, old)))
        .collect()
}

/// Compares one box's two versions (either missing): its members, its status (`file_status` for the file's own box;
/// changed if any member changed) and diff, and the names it mentions, for `find_dependencies`.
fn compare_box(file: &RepoPath, n: Option<&ParsedBox>, o: Option<&ParsedBox>, broken: bool, file_status: ChangeStatus) -> Parsed {
    let x = n.or(o).unwrap();
    let id = BoxId(if x.kind == BoxKind::File { file.as_str().into() } else { format!("{}::{}", file.as_str(), x.name) });
    let (mut calls, mut member_types) = (vec![], vec![]);
    let members: Vec<Member> = pair(n.map_or(&[][..], |n| &n.members[..]), o.map_or(&[][..], |o| &o.members[..]), |m| &m.name)
        .into_iter().filter(|(nm, _)| nm.is_some() || !broken)
        .map(|(nm, om)| {
            let m = compare_member(&id, nm, om);
            let raw = nm.or(om).unwrap();
            calls.extend(raw.calls.iter().map(|(q, n)| [m.id.0.clone(), q.clone(), n.clone()]));
            member_types.push((m.id.0.clone(), m.kind, raw.types.iter().cloned().collect()));
            m
        })
        .collect();
    let status = match status(n.map(|n| (&n.text, &n.impls)), o.map(|o| (&o.text, &o.impls))) {
        _ if x.kind == BoxKind::File => file_status,
        ChangeStatus::Same if members.iter().any(|m| m.status != ChangeStatus::Same) => ChangeStatus::Changed,
        st => st,
    };
    let md = x.kind == BoxKind::File && file.as_str().ends_with(".md");
    // A file box is code only for a language visvet parses; a type or impl always is.
    let code = x.kind != BoxKind::File || matches!(file.as_str().rsplit('.').next(), Some("rs" | "ts" | "tsx"));
    let content = if code {
        BoxContent::Code { kind: x.kind, members, implements: vec![], coverage: None }
    } else if md {
        BoxContent::Doc { labels: markdown::labels(&x.text) }
    } else {
        BoxContent::Plain
    };
    let map_box = MapBox {
        id,
        name: x.name.clone(),
        file: file.clone(),
        lines: lines(x.line, &x.text),
        doc: x.doc.clone(),
        status,
        diff: diff(n.map(|n| (&*n.text, n.line)), o.map(|o| (&*o.text, o.line))),
        content,
    };
    let mut generates: Vec<String> = codegen::targets(file.as_str(), &x.text).into_iter().map(|f| format!("{f}::{}", x.name)).collect();
    if x.kind == BoxKind::File {
        generates.extend(codegen::lock_files(file).iter().map(RepoPath::to_string));
    }
    let links = if md { markdown::links(file.as_str(), &x.text) } else { vec![] };
    Parsed { map_box, types: x.refs.iter().cloned().collect(), member_types, traits: x.impls.iter().cloned().collect(), imports: x.uses.clone(), calls, generates, links }
}

/// Compares one member's two versions (either missing) of box `box_id`.
fn compare_member(box_id: &BoxId, n: Option<&ParsedMember>, o: Option<&ParsedMember>) -> Member {
    let m = n.or(o).unwrap();
    Member {
        id: MemberId(format!("{box_id}::{}", m.name)),
        name: m.name.clone(),
        kind: m.kind,
        signature: m.sig.clone(),
        doc: m.doc.clone(),
        lines: lines(m.line, &m.text),
        status: status(n.map(|m| &m.text), o.map(|m| &m.text)),
        complexity: m.complexity,
        coverage: None,
        diff: diff(n.map(|m| (&*m.text, m.line)), o.map(|m| (&*m.text, m.line))),
    }
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
pub(crate) mod tests {
    use super::*;

    /// `compare_file` for a path given as text.
    pub fn cmp(f: &str, new: Option<&[u8]>, old: Option<&[u8]>) -> Vec<Parsed> {
        compare_file(&RepoPath(f.into()), new, old)
    }
    use DiffLineKind as L;
    use ChangeStatus::*;

    #[test]
    fn status_and_diff() {
        let old = "struct S { a: u8 }\nimpl S {\n    fn keep(&self) {}\n    fn edit(&self) {\n        1;\n    }\n    fn gone(&self) {}\n}\nstruct Same;\n";
        let new = "struct S { a: u8 }\n\nimpl S {\n    fn keep(&self) {}\n    fn edit(&self) {\n        x?;\n    }\n    fn added(&self) {}\n}\nstruct Same;\n";
        let objs = cmp("a.rs", Some(new.as_bytes()), Some(old.as_bytes()));
        let (f, s, same) = (&objs[0].map_box, &objs[1].map_box, &objs[2].map_box);
        let fd: Vec<_> = f.diff.iter().filter(|d| d.kind != DiffLineKind::Context).map(|d| (d.kind, d.line)).collect();
        assert_eq!((f.id.as_str(), f.kind(), f.status, f.lines.first, fd), ("a.rs", BoxKind::File, Changed, 1, vec![(L::Added, 2), (L::Removed, 5), (L::Added, 6), (L::Removed, 7), (L::Added, 8)]));
        assert_eq!((s.id.as_str(), s.status, same.status), ("a.rs::S", Changed, Same));
        let st: Vec<_> = s.members().iter().map(|m| (m.id.as_str(), m.status)).collect();
        assert_eq!(st, [("a.rs::S::a", Same), ("a.rs::S::keep", Same), ("a.rs::S::edit", Changed), ("a.rs::S::added", Added), ("a.rs::S::gone", Removed)]);
        let d: Vec<_> = s.members()[2].diff.iter().map(|d| (d.kind, d.text.as_str(), d.line)).collect();
        assert_eq!(d, [(L::Context, "    fn edit(&self) {", 5), (L::Removed, "        1;", 5), (L::Added, "        x?;", 6), (L::Context, "    }", 7)]);
        assert_eq!((same.diff[0].kind, same.diff[0].line), (L::Context, 10));
        assert_eq!(s.members()[4].diff[0].kind, DiffLineKind::Removed);
        // Complexity comes from the new version; closures count toward their fn.
        let rs = "fn f() { if let Some(_) = a && b || c { x?; } for _ in x {} while a {} loop {} match a { 1 => {} _ => {} } let g = || if a {}; }";
        let ts = "function f() { if (a && b || c) {} for (;;) {} for (x of a) {} while (a) {} do {} while (a); try {} catch {} switch (a) { case 1: default: } return a ?? (b ? 1 : 2) }";
        let cx = |f: &str, s: &str| cmp(f, Some(s.as_bytes()), None)[0].map_box.members()[0].complexity;
        assert_eq!((s.members()[0].complexity, s.members()[2].complexity, cx("d.rs", rs), cx("d.ts", ts)), (1, 1, 9, 12));
        let added = cmp("b.rs", Some(b"fn f() {}"), None);
        assert_eq!((added[0].map_box.id.as_str(), added[0].map_box.status, added[0].map_box.members()[0].id.as_str()), ("b.rs", Added, "b.rs::f"));
        let bin = cmp("a.png", Some(&[0xff, 1]), Some(&[0xff]));
        assert_eq!((bin.len(), bin[0].map_box.status, bin[0].map_box.diff.len()), (1, Changed, 0));
        let toml = &cmp("x.toml", Some(b"a = 1\nb = 2"), Some(b"a = 1"))[0].map_box;
        let d: Vec<_> = toml.diff.iter().map(|d| (d.kind, d.line)).collect();
        assert_eq!((toml.status, toml.members().len(), d), (Changed, 0, vec![(L::Context, 1), (L::Added, 2)]));
        assert_eq!(cmp("x.md", Some(b"same"), Some(b"same"))[0].map_box.status, Same); // unchanged files stay on the map
        // What a box holds depends on what it is: code, a Markdown document, or any other file.
        assert!(matches!(&toml.content, BoxContent::Plain));
        let issue = &cmp("i.md", Some(b"---\nkind: issue\n---\n# Fix"), None)[0].map_box;
        assert!(matches!(&issue.content, BoxContent::Doc { labels } if labels.kind == Some(crate::types::DocKind::Issue)));
        assert!(matches!(&s.content, BoxContent::Code { kind: BoxKind::Struct, .. }));
        assert_eq!(cmp("c.rs", Some(b"#[derive(Debug)]\nstruct C;"), Some(b"struct C;"))[1].map_box.status, Changed);
    }
}

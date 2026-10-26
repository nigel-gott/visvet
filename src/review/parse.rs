//! Parsing one version of one file with tree-sitter: its type-like objects and their members, with the names they
//! mention, not yet linked to anything.
mod names;
mod rust;
mod ts;
mod walk;

use crate::types::{MemberKind, RepoPath, UnitKind};
use std::collections::{BTreeSet, HashSet};
use std::path::{Component, Path, PathBuf};
use tree_sitter::Parser;
use walk::FileParser;

/// A raw object from one version of a file, before it is paired with the other version.
#[derive(Default, Debug)]
pub struct Obj {
    pub name: String,
    pub kind: UnitKind,
    pub line: u32,
    pub text: String,
    pub doc: String,
    pub impls: BTreeSet<String>,
    pub members: Vec<Mem>,
    pub refs: BTreeSet<String>,
    /// File objects only: per import, candidate repo paths in preference order.
    pub uses: Vec<Vec<String>>,
    /// File objects only: the parse has a top-level syntax error (e.g. mid-edit).
    pub broken: bool,
}

/// A raw member (field, variant, method or free fn) of an `Obj`.
#[derive(Debug)]
pub struct Mem {
    pub name: String,
    pub kind: MemberKind,
    pub sig: String,
    pub text: String,
    pub doc: String,
    pub line: u32,
    /// Fns and methods only: calls and constructions in the body, see `FileParser::calls`.
    pub calls: Vec<(String, String)>,
    /// 1 + the body's decision points (see `decision`); 1 for members without a body.
    pub complexity: u32,
    /// Type names for arrows: a field's or variant's type ("has"), or the types a function's body
    /// really uses, see `FileParser::uses` ("uses").
    pub types: BTreeSet<String>,
}

/// A "file" object (whole text, free fns as members, imports) followed by the file's types.
/// Only .rs/.ts/.tsx files are parsed.
pub fn parse(path: &str, src: &str) -> Vec<Obj> {
    let file = Obj { name: path.into(), kind: UnitKind::File, line: 1, text: src.into(), doc: head_doc(path, src), ..Default::default() };
    let mut parser = FileParser { src, path, objs: vec![file] };
    let lang = match path.rsplit('.').next() {
        Some("rs") => tree_sitter_rust::LANGUAGE,
        Some("ts") => tree_sitter_typescript::LANGUAGE_TYPESCRIPT,
        Some("tsx") => tree_sitter_typescript::LANGUAGE_TSX,
        _ => return parser.objs,
    };
    let mut p = Parser::new();
    p.set_language(&lang.into()).expect("grammar");
    let Some(tree) = p.parse(src, None) else { return parser.objs };
    for n in tree.root_node().named_children(&mut tree.walk()) {
        parser.objs[0].broken |= n.is_error();
        parser.item(n);
    }
    // Member names make ids: unique per object, and a free fn must not reuse a type's name.
    let types: HashSet<String> = parser.objs[1..].iter().map(|o| o.name.clone()).collect();
    for (i, o) in parser.objs.iter_mut().enumerate() {
        let mut taken = if i == 0 { types.clone() } else { HashSet::new() };
        for m in &mut o.members {
            let (name, mut k) = (m.name.clone(), 1);
            while !taken.insert(m.name.clone()) {
                k += 1;
                m.name = format!("{name}#{k}");
            }
        }
    }
    parser.objs
}

/// The folder a repo-relative file is in ("" at the root): Rust's `Path::parent`, which only lacks an answer for "".
pub fn dir(path: &str) -> &Path {
    Path::new(path).parent().unwrap_or(Path::new(""))
}

/// Joins a relative path, as written in a file (an import, a link), onto a repo-relative dir, resolving `.` and `..`
/// as text; a `rel` starting with `/` starts from the repo root. Rust's own paths leave `..` in, because on disk a symlink can make `a/b/..` differ from `a`; repo paths
/// come from git, which never follows symlinks, so resolving as text is right here.
pub fn join(dir: impl AsRef<Path>, rel: &str) -> RepoPath {
    let mut out = PathBuf::new();
    for c in dir.as_ref().join(rel).components() {
        match c {
            Component::ParentDir => _ = out.pop(),
            Component::Normal(s) => out.push(s),
            Component::CurDir | Component::RootDir | Component::Prefix(_) => {}
        }
    }
    RepoPath(out)
}

/// A file's leading comment block. Markdown: the one-line frontmatter `description:`, else the first heading.
fn head_doc(path: &str, src: &str) -> String {
    let ext = path.rsplit('.').next().unwrap_or("");
    let s = src.trim_start();
    let s = if s.starts_with("#!") { s.split_once('\n').map_or("", |(_, r)| r).trim_start() } else { s };
    if ext == "md" {
        let (front, body) = s.strip_prefix("---").and_then(|f| f.split_once("\n---")).unwrap_or(("", s));
        let desc = front.lines().find_map(|l| l.strip_prefix("description:")).map(|d| d.trim().trim_matches(['"', '\''])).filter(|d| !d.is_empty() && !d.starts_with(['>', '|']));
        return clean(desc.or_else(|| body.lines().find(|l| l.starts_with('#'))).unwrap_or(""));
    }
    for (open, close) in [("/*", "*/"), ("<!--", "-->")] {
        if let Some(b) = s.strip_prefix(open).filter(|_| ext != "rs") {
            return clean(b.split(close).next().unwrap());
        }
    }
    let mark = match ext { "rs" => "//!", "ts" | "tsx" | "js" | "jsx" | "css" => "//", _ => "#" };
    clean(&s.lines().take_while(|l| l.trim_start().starts_with(mark)).collect::<Vec<_>>().join("\n"))
}

/// Strips comment markers; keeps the first paragraph (up to a blank or `@tag` line) on one line,
/// capped at 300 chars.
pub(super) fn clean(text: &str) -> String {
    let mut words = vec![];
    for l in text.lines() {
        let l = l.trim().trim_start_matches(['/', '*', '!', '#']).trim_end_matches("*/").trim();
        if l.starts_with('@') || l.is_empty() && !words.is_empty() {
            break;
        }
        words.extend(l.split_whitespace());
    }
    words.join(" ").chars().take(300).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use MemberKind::{Field, Method, Variant};

    fn get<'a>(objs: &'a [Obj], name: &str) -> &'a Obj {
        objs.iter().find(|o| o.name == name).unwrap()
    }

    fn names(o: &Obj) -> Vec<(MemberKind, &str)> {
        o.members.iter().map(|m| (m.kind, m.name.as_str())).collect()
    }

    fn set(xs: &[&str]) -> BTreeSet<String> {
        xs.iter().map(|x| x.to_string()).collect()
    }

    #[test]
    fn join_resolves_dots() {
        for (dir, rel, out) in [("issues", "../src/a.rs", "src/a.rs"), ("ui/src", "./model", "ui/src/model"), ("", "a/../../b", "b"), ("a", "/b", "b")] {
            assert_eq!(join(dir, rel).as_str(), out);
        }
    }

    #[test]
    fn rust_struct_impl_merge() {
        let src = "//! File doc.\n//!\n//! More.\nimpl Foo {\n    /// Makes one.\n    pub fn new(\n        x: u8,\n    ) -> Self { todo!() }\n    pub fn a(&self) -> u8 { 1 }\n}\nimpl fmt::Display for Foo<T> { fn fmt(&self) {} }\n/// The foo.\n/// Really.\n///\n/// Details.\n#[derive(\n    Debug,\n)]\npub struct Foo { pub a: Vec<Bar>, b: u8 }\nenum E { A(Baz), B }\nimpl Ext for Other {}\n// plain\nfn free() {}\n#[cfg(test)]\nmod tests { struct Hidden; }\n";
        let objs = parse("a.rs", src);
        let foo = get(&objs, "Foo");
        assert_eq!((foo.kind, foo.line, &foo.impls, &foo.refs), (UnitKind::Struct, 12, &set(&["Display"]), &set(&[])));
        assert_eq!(foo.members[3].types, set(&["Bar", "Vec"]));
        assert!(foo.text.starts_with("/// The foo.\n") && foo.text.ends_with("b: u8 }"));
        assert_eq!(names(foo), [(Method, "new"), (Method, "a"), (Method, "fmt"), (Field, "a#2"), (Field, "b")]);
        assert_eq!(foo.members[0].sig, "pub fn new( x: u8, ) -> Self");
        assert!(foo.members[0].text.starts_with("    /// Makes one.\n    pub fn new("));
        assert_eq!((foo.members[3].sig.as_str(), foo.members[3].text.as_str()), ("pub a: Vec<Bar>", "pub a: Vec<Bar>"));
        let docs = (objs[0].doc.as_str(), foo.doc.as_str(), foo.members[0].doc.as_str(), objs[0].members[0].doc.as_str());
        assert_eq!(docs, ("File doc.", "The foo. Really.", "Makes one.", ""));
        let e = get(&objs, "E");
        assert_eq!((&e.members[0].types, names(e), e.members[1].text.as_str()), (&set(&["Baz"]), vec![(Variant, "A"), (Variant, "B")], "B"));
        assert_eq!((get(&objs, "Other").kind, &get(&objs, "Other").impls), (UnitKind::Impl, &set(&["Ext"])));
        assert_eq!((objs[0].kind, objs[0].text.as_str(), names(&objs[0])), (UnitKind::File, src, vec![(MemberKind::Fn, "free")]));
        assert!(objs.iter().all(|o| o.name != "Hidden"));
    }

    #[test]
    fn ts_class_interface() {
        let src = "/** The C class.\n * More.\n *\n * Details. */\nexport class C extends Base<T> implements I {\n  x: Foo; // trailing\n  // Runs it.\n  run(a: { b: number }): void {}\n  get v() { return 1 }\n  set v(x) {}\n}\ninterface I extends J { p: Bar; m(): void; }\nexport const f = (a: number) => { return a };\nfunction g() {}\ntype U = Foo | Baz;\nenum E { A, B = 2 }\ntype P<K> = { a: K; m(): Foo }\nconst U = () => 1;\n";
        let objs = parse("a.tsx", src);
        let c = get(&objs, "C");
        assert_eq!((c.kind, c.line, &c.impls, &c.refs), (UnitKind::Class, 1, &set(&["Base", "I"]), &set(&[])));
        assert_eq!(c.members[0].types, set(&["Foo"]));
        assert!(c.text.starts_with("/** The C class.") && c.text.contains("\nexport class C"));
        assert_eq!(names(c), [(Field, "x"), (Method, "run"), (Method, "v"), (Method, "v#2")]);
        assert_eq!(c.members[1].sig, "run(a: { b: number }): void");
        let docs = (objs[0].doc.as_str(), c.doc.as_str(), c.members[0].doc.as_str(), c.members[1].doc.as_str());
        assert_eq!(docs, ("The C class. More.", "The C class. More.", "", "Runs it."));
        for (p, s, d) in [("x.md", "---\ndescription: \"Hi there\"\n---\n# T", "Hi there"), ("y.md", "# Title\n\nProse.", "Title"),
            ("x.sh", "#!/bin/sh\n# Deploys.\n\n# other", "Deploys."), ("i.html", "<!-- Entry\n page. -->\n<html>", "Entry page.")] {
            assert_eq!(parse(p, s)[0].doc, d);
        }
        let i = get(&objs, "I");
        assert_eq!((i.kind, &i.impls, &i.members[0].types), (UnitKind::Interface, &set(&["J"]), &set(&["Bar"])));
        assert_eq!(names(i), [(Field, "p"), (Method, "m")]);
        let m = get(&objs, "a.tsx");
        assert_eq!((m.kind, names(m)), (UnitKind::File, vec![(MemberKind::Fn, "f"), (MemberKind::Fn, "g"), (MemberKind::Fn, "U#2")]));
        assert_eq!(m.members[0].sig, "const f = (a: number) =>");
        assert_eq!(get(&objs, "U").refs, set(&["Baz", "Foo", "U"]));
        let p = get(&objs, "P");
        assert_eq!((names(p), &p.refs), (vec![(Field, "a"), (Method, "m")], &set(&["Foo", "P"])));
        assert_eq!(names(get(&objs, "E")), [(Variant, "A"), (Variant, "B")]);
    }
}

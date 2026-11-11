//! Parsing one version of one file, with tree-sitter or for a Lisp-family file `lisp`'s own reader: its boxes (the
//! file itself and each type-like thing in it) and their members, with the names they mention, not yet linked to anything.
pub mod lisp;
mod names;
mod rust;
mod ts;
mod walk;

use crate::types::{Language, MemberKind, RepoPath, BoxKind};
use std::collections::{BTreeSet, HashSet};
use std::path::{Component, Path, PathBuf};
use tree_sitter::Parser;
use walk::FileParser;

/// A box as parsed from one version of a file: the file itself, or a type, class, interface or impl in it.
/// Comparing it with the same box in the other version gives the `MapBox` shown on the map.
#[derive(Default, Debug)]
pub struct ParsedBox {
    pub name: String,
    pub kind: BoxKind,
    pub line: u32,
    pub text: String,
    pub doc: String,
    /// The traits, interfaces or base classes it implements or extends, as written.
    pub impls: BTreeSet<Mention>,
    pub members: Vec<ParsedMember>,
    /// Types it names outside any member: a type alias's, a tuple struct's.
    pub refs: BTreeSet<Mention>,
    /// File boxes only: each name the file imports.
    pub imports: Vec<Import>,
    /// File boxes only: the Rust modules it declares to live in other files, e.g. "parse" for `mod parse;`.
    pub mods: Vec<String>,
    /// File boxes only: the parse has a top-level syntax error (e.g. mid-edit).
    pub broken: bool,
}

/// A raw member (field, variant, method or free fn) of a `ParsedBox`.
#[derive(Debug)]
pub struct ParsedMember {
    pub name: String,
    pub kind: MemberKind,
    pub sig: String,
    pub text: String,
    pub doc: String,
    pub line: u32,
    /// Fns and methods only: the functions the body calls, see `FileParser::calls`.
    pub calls: Vec<Mention>,
    /// Fns and methods only: the types the body builds, with a Rust struct literal or a TS `new`.
    pub creates: Vec<Mention>,
    /// 1 + the body's decision points (see `decision`); 1 for members without a body.
    pub complexity: u32,
    /// Type names for arrows: a field's or variant's type ("has"), or the types a function's body
    /// really uses, see `FileParser::uses` ("uses").
    pub types: BTreeSet<Mention>,
}

/// A name the code mentions, as written, and the line it is on: a Rust path such as "fmt::Display" or "Self::new",
/// a TypeScript name such as "Review", or a Lisp-family symbol such as "stew" or "kitchen/stew". Nothing says yet what it means; `resolve` works that out.
#[derive(Debug, Clone, PartialEq, Eq, PartialOrd, Ord)]
pub struct Mention {
    pub path: String,
    pub line: u32,
    /// Lisp-family files only: whether it is written as the head of a form, like `stew` in `(stew 2)`.
    pub as_head: bool,
}

impl Mention {
    /// The first name of the path, e.g. "fmt" of "fmt::Display".
    pub fn first_name(&self) -> &str {
        self.path.split("::").next().unwrap_or("")
    }
}

/// One name a file brings into scope, or a whole module's names.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Import {
    /// The name code in the file then uses, e.g. "Json" for `use axum::Json` or "S" for `use a::Store as S`;
    /// `EVERY_NAME` for a glob such as `use a::*` or `export * from './a'`.
    pub name: String,
    /// Rust: the whole path as written, e.g. ["crate", "types", "MapBox"]. TypeScript: the name inside the imported
    /// file, e.g. ["Review"] or ["default"], or nothing when the file itself is meant (`import * as model`).
    pub path: Vec<String>,
    /// TypeScript only: the repo files the import's source may be, in preference order.
    pub files: Vec<RepoPath>,
    pub line: u32,
}

/// An `Import::name` that stands for every name of the module imported.
pub const EVERY_NAME: &str = "*";

/// The "file" box (whole text, free fns as members, imports) followed by the file's types.
/// Only .rs/.ts/.tsx files are parsed this way; a Lisp-family file's boxes are its top-level forms (see `lisp`).
pub fn parse(path: &RepoPath, src: &str) -> Vec<ParsedBox> {
    let language = Language::of(path);
    let file = ParsedBox { name: path.to_string(), kind: BoxKind::File, line: 1, text: src.into(), doc: head_doc(language, src), ..Default::default() };
    let mut file = file;
    if language == Language::Lisp {
        let forms = lisp::forms(src, &mut file);
        return std::iter::once(file).chain(forms).collect();
    }
    let mut parser = FileParser { src, path, language, boxes: vec![file] };
    let Some(grammar) = grammar(language) else { return parser.boxes };
    let mut p = Parser::new();
    p.set_language(&grammar).expect("grammar");
    let Some(tree) = p.parse(src, None) else { return parser.boxes };
    for n in tree.root_node().named_children(&mut tree.walk()) {
        parser.boxes[0].broken |= n.is_error();
        parser.item(n);
    }
    // Member names make ids: unique per box, and a free fn must not reuse a type's name.
    let types: HashSet<String> = parser.boxes[1..].iter().map(|o| o.name.clone()).collect();
    for (i, o) in parser.boxes.iter_mut().enumerate() {
        let mut taken = if i == 0 { types.clone() } else { HashSet::new() };
        for m in &mut o.members {
            let (name, mut k) = (m.name.clone(), 1);
            while !taken.insert(m.name.clone()) {
                k += 1;
                m.name = format!("{name}#{k}");
            }
        }
    }
    parser.boxes
}

/// The tree-sitter grammar that parses `language` into boxes, for the languages visvet parses.
fn grammar(language: Language) -> Option<tree_sitter::Language> {
    Some(match language {
        Language::Rust => tree_sitter_rust::LANGUAGE.into(),
        Language::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT.into(),
        Language::Tsx => tree_sitter_typescript::LANGUAGE_TSX.into(),
        _ => return None,
    })
}

/// Joins a relative path, as written in a file (an import, a link), onto a repo-relative dir, resolving `.` and `..`
/// as text; a `rel` starting with `/` starts from the repo root. Rust's own paths leave `..` in, because on disk a symlink can make `a/b/..` differ from `a`; repo paths
/// come from git, which never follows symlinks, so resolving as text is right here.
pub fn join(dir: &Path, rel: &str) -> RepoPath {
    let mut out = PathBuf::new();
    for c in dir.join(rel).components() {
        match c {
            Component::ParentDir => _ = out.pop(),
            Component::Normal(s) => out.push(s),
            Component::CurDir | Component::RootDir | Component::Prefix(_) => {}
        }
    }
    RepoPath(out)
}

/// A file's leading comment block. Markdown: the one-line frontmatter `description:`, else the first heading.
fn head_doc(language: Language, src: &str) -> String {
    let s = src.trim_start();
    let s = if s.starts_with("#!") { s.split_once('\n').map_or("", |(_, r)| r).trim_start() } else { s };
    if language == Language::Markdown {
        let (front, body) = s.strip_prefix("---").and_then(|f| f.split_once("\n---")).unwrap_or(("", s));
        let desc = front.lines().find_map(|l| l.strip_prefix("description:")).map(|d| d.trim().trim_matches(['"', '\''])).filter(|d| !d.is_empty() && !d.starts_with(['>', '|']));
        return clean(desc.or_else(|| body.lines().find(|l| l.starts_with('#'))).unwrap_or(""));
    }
    for (open, close) in [("/*", "*/"), ("<!--", "-->")] {
        if let Some(b) = s.strip_prefix(open).filter(|_| language != Language::Rust) {
            return clean(b.split(close).next().unwrap());
        }
    }
    clean(&s.lines().take_while(|l| l.trim_start().starts_with(language.file_comment())).collect::<Vec<_>>().join("\n"))
}

/// Strips comment markers; keeps the first paragraph (up to a blank or `@tag` line) on one line,
/// capped at 300 chars.
pub(super) fn clean(text: &str) -> String {
    let mut words = vec![];
    for l in text.lines() {
        let l = l.trim().trim_start_matches(['/', '*', '!', '#', ';']).trim_end_matches("*/").trim();
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

    fn get<'a>(boxes: &'a [ParsedBox], name: &str) -> &'a ParsedBox {
        boxes.iter().find(|o| o.name == name).unwrap()
    }

    fn names(o: &ParsedBox) -> Vec<(MemberKind, &str)> {
        o.members.iter().map(|m| (m.kind, m.name.as_str())).collect()
    }

    /// The paths of `mentions`, in order.
    fn paths(mentions: &BTreeSet<Mention>) -> Vec<&str> {
        mentions.iter().map(|mention| mention.path.as_str()).collect()
    }

    #[test]
    fn join_resolves_dots() {
        for (dir, rel, out) in [("issues", "../src/a.rs", "src/a.rs"), ("ui/src", "./model", "ui/src/model"), ("", "a/../../b", "b"), ("a", "/b", "b")] {
            assert_eq!(join(Path::new(dir), rel).as_str(), out);
        }
    }

    #[test]
    fn rust_struct_impl_merge() {
        let src = "//! File doc.\n//!\n//! More.\nimpl Foo {\n    /// Makes one.\n    pub fn new(\n        x: u8,\n    ) -> Self { todo!() }\n    pub fn a(&self) -> u8 { 1 }\n}\nimpl fmt::Display for Foo<T> { fn fmt(&self) {} }\n/// The foo.\n/// Really.\n///\n/// Details.\n#[derive(\n    Debug,\n)]\npub struct Foo { pub a: Vec<Bar>, b: u8 }\nenum E { A(Baz), B }\nimpl Ext for Other {}\n// plain\nfn free() {}\n#[cfg(test)]\nmod tests { struct Hidden; }\n";
        let boxes = parse(&RepoPath("a.rs".into()), src);
        let foo = get(&boxes, "Foo");
        assert_eq!((foo.kind, foo.line, paths(&foo.impls), paths(&foo.refs)), (BoxKind::Struct, 12, vec!["fmt::Display"], vec![]));
        assert_eq!(paths(&foo.members[3].types), ["Bar", "Vec"]);
        assert!(foo.text.starts_with("/// The foo.\n") && foo.text.ends_with("b: u8 }"));
        assert_eq!(names(foo), [(Method, "new"), (Method, "a"), (Method, "fmt"), (Field, "a#2"), (Field, "b")]);
        assert_eq!(foo.members[0].sig, "pub fn new( x: u8, ) -> Self");
        assert!(foo.members[0].text.starts_with("    /// Makes one.\n    pub fn new("));
        assert_eq!((foo.members[3].sig.as_str(), foo.members[3].text.as_str()), ("pub a: Vec<Bar>", "pub a: Vec<Bar>"));
        let docs = (boxes[0].doc.as_str(), foo.doc.as_str(), foo.members[0].doc.as_str(), boxes[0].members[0].doc.as_str());
        assert_eq!(docs, ("File doc.", "The foo. Really.", "Makes one.", ""));
        let e = get(&boxes, "E");
        assert_eq!((paths(&e.members[0].types), names(e), e.members[1].text.as_str()), (vec!["Baz"], vec![(Variant, "A"), (Variant, "B")], "B"));
        assert_eq!((get(&boxes, "Other").kind, paths(&get(&boxes, "Other").impls)), (BoxKind::Impl, vec!["Ext"]));
        assert_eq!((boxes[0].kind, boxes[0].text.as_str(), names(&boxes[0])), (BoxKind::File, src, vec![(MemberKind::Fn, "free")]));
        assert!(boxes.iter().all(|o| o.name != "Hidden"));
    }

    #[test]
    fn ts_class_interface() {
        let src = "/** The C class.\n * More.\n *\n * Details. */\nexport class C extends Base<T> implements I {\n  x: Foo; // trailing\n  // Runs it.\n  run(a: { b: number }): void {}\n  get v() { return 1 }\n  set v(x) {}\n}\ninterface I extends J { p: Bar; m(): void; }\nexport const f = (a: number) => { return a };\nfunction g() {}\ntype U = Foo | Baz;\nenum E { A, B = 2 }\ntype P<K> = { a: K; m(): Foo }\nconst U = () => 1;\n";
        let boxes = parse(&RepoPath("a.tsx".into()), src);
        let c = get(&boxes, "C");
        assert_eq!((c.kind, c.line, paths(&c.impls), paths(&c.refs)), (BoxKind::Class, 1, vec!["Base", "I"], vec![]));
        assert_eq!(paths(&c.members[0].types), ["Foo"]);
        assert!(c.text.starts_with("/** The C class.") && c.text.contains("\nexport class C"));
        assert_eq!(names(c), [(Field, "x"), (Method, "run"), (Method, "v"), (Method, "v#2")]);
        assert_eq!(c.members[1].sig, "run(a: { b: number }): void");
        let docs = (boxes[0].doc.as_str(), c.doc.as_str(), c.members[0].doc.as_str(), c.members[1].doc.as_str());
        assert_eq!(docs, ("The C class. More.", "The C class. More.", "", "Runs it."));
        for (p, s, d) in [("x.md", "---\ndescription: \"Hi there\"\n---\n# T", "Hi there"), ("y.md", "# Title\n\nProse.", "Title"),
            ("x.sh", "#!/bin/sh\n# Deploys.\n\n# other", "Deploys."), ("spells.sexp", ";; Every spell.\n(spell warm :cast 4s)", "Every spell."), ("i.html", "<!-- Entry\n page. -->\n<html>", "Entry page.")] {
            assert_eq!(parse(&RepoPath(p.into()), s)[0].doc, d);
        }
        let i = get(&boxes, "I");
        assert_eq!((i.kind, paths(&i.impls), paths(&i.members[0].types)), (BoxKind::Interface, vec!["J"], vec!["Bar"]));
        assert_eq!(names(i), [(Field, "p"), (Method, "m")]);
        let m = get(&boxes, "a.tsx");
        assert_eq!((m.kind, names(m)), (BoxKind::File, vec![(MemberKind::Fn, "f"), (MemberKind::Fn, "g"), (MemberKind::Fn, "U#2")]));
        assert_eq!(m.members[0].sig, "const f = (a: number) =>");
        assert_eq!(paths(&get(&boxes, "U").refs), ["Baz", "Foo", "U"]);
        let p = get(&boxes, "P");
        assert_eq!((names(p), paths(&p.refs)), (vec![(Field, "a"), (Method, "m")], vec!["Foo", "P"]));
        assert_eq!(names(get(&boxes, "E")), [(Variant, "A"), (Variant, "B")]);
    }
}

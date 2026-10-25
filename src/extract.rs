//! Tree-sitter extraction of type-like objects and their members from one file.
use std::collections::{BTreeSet, HashSet};
use crate::types::{MemberKind, UnitKind};
use tree_sitter::{Node, Parser};

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
    /// Fns and methods only: calls and constructions in the body, see `Ex::calls`.
    pub calls: Vec<(String, String)>,
    /// 1 + the body's decision points (see `decision`); 1 for members without a body.
    pub complexity: u32,
    /// Type names for arrows: a field's or variant's type ("has"), or the types a function's body
    /// really uses, see `Ex::uses` ("uses").
    pub types: BTreeSet<String>,
}

/// Extraction state for one file: its source, path and the objects found so far.
struct Ex<'a> {
    src: &'a str,
    path: &'a str,
    objs: Vec<Obj>,
}

/// A "file" object (whole text, free fns as members, imports) followed by the file's types.
/// Only .rs/.ts/.tsx files are parsed.
pub fn extract(path: &str, src: &str) -> Vec<Obj> {
    let file = Obj { name: path.into(), kind: UnitKind::File, line: 1, text: src.into(), doc: head_doc(path, src), ..Default::default() };
    let mut x = Ex { src, path, objs: vec![file] };
    let lang = match path.rsplit('.').next() {
        Some("rs") => tree_sitter_rust::LANGUAGE,
        Some("ts") => tree_sitter_typescript::LANGUAGE_TYPESCRIPT,
        Some("tsx") => tree_sitter_typescript::LANGUAGE_TSX,
        _ => return x.objs,
    };
    let mut p = Parser::new();
    p.set_language(&lang.into()).expect("grammar");
    let Some(tree) = p.parse(src, None) else { return x.objs };
    for n in tree.root_node().named_children(&mut tree.walk()) {
        x.objs[0].broken |= n.is_error();
        x.item(n);
    }
    // Member names make ids: unique per object, and a free fn must not reuse a type's name.
    let types: HashSet<String> = x.objs[1..].iter().map(|o| o.name.clone()).collect();
    for (i, o) in x.objs.iter_mut().enumerate() {
        let mut taken = if i == 0 { types.clone() } else { HashSet::new() };
        for m in &mut o.members {
            let (name, mut k) = (m.name.clone(), 1);
            while !taken.insert(m.name.clone()) {
                k += 1;
                m.name = format!("{name}#{k}");
            }
        }
    }
    x.objs
}

/// The node's 1-based start line.
fn line(n: Node) -> u32 {
    n.start_position().row as u32 + 1
}

/// The node, or the `export` statement around it (which also holds its decorators).
fn outer(n: Node) -> Node {
    n.parent().filter(|p| p.kind() == "export_statement").unwrap_or(n)
}

/// The directory part of a repo-relative path ("" at the root).
fn dir(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(d, _)| d)
}

/// Joins a relative path onto a repo-relative dir, resolving `.` and `..`.
fn join(dir: &str, rel: &str) -> String {
    let mut out = vec![];
    for s in dir.split('/').chain(rel.split('/')) {
        match s {
            "" | "." => {}
            ".." => _ = out.pop(),
            s => out.push(s),
        }
    }
    out.join("/")
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
fn clean(text: &str) -> String {
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

/// Whether `n` adds a path through its function: a branch, loop, match arm, case, catch, `?`, or `&&`/`||`/`??`.
fn decision(n: Node) -> bool {
    let op = matches!(n.kind(), "&&" | "||" | "??") && n.parent().is_some_and(|p| matches!(p.kind(), "binary_expression" | "let_chain"));
    op || matches!(n.kind(), "if_expression" | "for_expression" | "while_expression" | "loop_expression" | "match_arm" | "try_expression"
        | "if_statement" | "for_statement" | "for_in_statement" | "while_statement" | "do_statement" | "switch_case" | "catch_clause" | "ternary_expression")
}

/// The object kind of a type-declaring node kind, if it is one.
fn type_kind(k: &str) -> Option<UnitKind> {
    Some(match k {
        "struct_item" => UnitKind::Struct,
        "enum_item" | "enum_declaration" => UnitKind::Enum,
        "trait_item" => UnitKind::Trait,
        "type_item" | "type_alias_declaration" => UnitKind::TypeAlias,
        "class_declaration" | "abstract_class_declaration" => UnitKind::Class,
        "interface_declaration" => UnitKind::Interface,
        _ => return None,
    })
}

/// `fmt::Display` -> `Display`, `Foo<T>` -> `Foo`.
fn base(s: &str) -> String {
    s.split('<').next().unwrap().rsplit([':', '.']).next().unwrap().trim().into()
}

impl<'a> Ex<'a> {
    /// The node's source text.
    fn t(&self, n: Node) -> &'a str {
        &self.src[n.byte_range()]
    }

    /// Where `n`'s text starts, that line's number, and its doc comment. The text takes in its
    /// `export`/decorators and the doc comment and attribute lines right above it, and starts at
    /// the beginning of its line unless other code precedes it there.
    fn head(&self, n: Node) -> (usize, u32, String) {
        let marks: &[&str] = if self.path.ends_with(".rs") { &["///", "/**"] } else { &["//", "/**"] };
        let lead = |b: usize| self.src[..b].rsplit('\n').next().unwrap();
        let (mut n, mut parts) = (outer(n), vec![]);
        while let Some(p) = n.prev_sibling() {
            let t = self.t(p).trim_end();
            let gap = &self.src[p.start_byte() + t.len()..n.start_byte()];
            if gap.matches('\n').count() > 1 || !lead(p.start_byte()).trim().is_empty() {
                break;
            }
            if p.kind().ends_with("comment") && marks.iter().any(|m| t.starts_with(m)) {
                parts.push(t);
            } else if p.kind() != "attribute_item" {
                break;
            }
            n = p;
        }
        parts.reverse();
        let b = n.start_byte();
        (if lead(b).trim().is_empty() { b - lead(b).len() } else { b }, line(n), clean(&parts.join("\n")))
    }

    /// Index of the object named `name`, adding an "impl" object when the type is declared elsewhere.
    fn obj(&mut self, name: &str, n: Node) -> usize {
        if let Some(i) = self.objs.iter().position(|o| o.name == name) {
            return i;
        }
        self.objs.push(Obj { name: name.into(), kind: UnitKind::Impl, line: line(n), ..Default::default() });
        self.objs.len() - 1
    }

    /// Handles one top-level item: imports, types, impls and free functions.
    fn item(&mut self, n: Node) {
        if let Some(s) = n.child_by_field_name("source") {
            return self.ts_import(s);
        }
        match n.kind() {
            "export_statement" => n.child_by_field_name("declaration").into_iter().for_each(|d| self.item(d)),
            "function_item" | "function_declaration" => {
                n.child_by_field_name("name").into_iter().for_each(|nm| self.add_member(0, MemberKind::Fn, n, self.t(nm), n.child_by_field_name("body")));
            }
            "lexical_declaration" => self.const_fns(n),
            "use_declaration" => self.rust_use(n),
            "impl_item" => self.rust_impl(n),
            k => type_kind(k).into_iter().for_each(|kind| self.type_item(n, kind)),
        }
    }

    /// Records a TS import or re-export from relative module `s`, as candidate files.
    fn ts_import(&mut self, s: Node) {
        let spec = self.t(s).trim_matches(['\'', '"']);
        if spec.starts_with('.') {
            let p = join(dir(self.path), spec);
            self.objs[0].uses.push(["", ".ts", ".tsx", "/index.ts", "/index.tsx"].map(|e| format!("{p}{e}")).into());
        }
    }

    /// Adds `const f = () => ...` and `const f = function ...` declarations as free fns.
    fn const_fns(&mut self, n: Node) {
        for d in n.named_children(&mut n.walk()) {
            let (Some(nm), Some(v)) = (d.child_by_field_name("name"), d.child_by_field_name("value")) else { continue };
            if matches!(v.kind(), "arrow_function" | "function_expression" | "function") {
                self.add_member(0, MemberKind::Fn, n, self.t(nm), v.child_by_field_name("body"));
            }
        }
    }

    /// Records the files of the crate modules a Rust `use crate::...` names.
    fn rust_use(&mut self, n: Node) {
        let Some(a) = n.child_by_field_name("argument") else { return };
        let krate = &self.path[..self.path.rfind("src/").map_or(dir(self.path).len(), |i| i + 3)];
        let list = a.child_by_field_name("list").filter(|_| a.child_by_field_name("path").is_some_and(|p| self.t(p) == "crate"));
        let items: Vec<&str> = match list {
            Some(l) => l.named_children(&mut l.walk()).map(|c| self.t(c)).collect(),
            None => self.t(a).strip_prefix("crate::").into_iter().collect(),
        };
        for m in items {
            let p = join(krate, m.split([':', ' ']).next().unwrap());
            self.objs[0].uses.push(vec![format!("{p}.rs"), format!("{p}/mod.rs")]);
        }
    }

    /// Adds a Rust impl block's methods, and its trait, to the object for its type.
    fn rust_impl(&mut self, n: Node) {
        let Some(ty) = n.child_by_field_name("type") else { return };
        let oi = self.obj(&base(self.t(ty)), n);
        if let Some(tr) = n.child_by_field_name("trait") {
            let tr = base(self.t(tr));
            self.objs[oi].impls.insert(tr);
        }
        self.members(oi, n, n.child_by_field_name("body"));
    }

    /// Adds a struct, enum, trait, type alias, class or interface with its text, doc, heritage, type refs and members.
    fn type_item(&mut self, n: Node, kind: UnitKind) {
        let Some(name) = n.child_by_field_name("name") else { return };
        let oi = self.obj(self.t(name), n);
        let (start, line, doc) = self.head(n);
        let o = &mut self.objs[oi];
        (o.kind, o.line, o.text, o.doc) = (kind, line, self.src[start..n.end_byte()].into(), doc);
        self.heritage(oi, n);
        let body = n.child_by_field_name("body").or_else(|| n.child_by_field_name("value").filter(|v| v.kind() == "object_type"));
        let whole = if kind == UnitKind::TypeAlias { Some(n) } else { body.filter(|b| b.kind() == "ordered_field_declaration_list") };
        if let Some(w) = whole {
            let names = self.type_names(w);
            self.objs[oi].refs.extend(names);
        }
        self.members(oi, n, body);
        if whole.is_some() {
            // A type alias's members are inside its whole text, whose names the alias already has.
            self.objs[oi].members.iter_mut().for_each(|m| m.types.clear());
        }
    }

    /// Records the base classes and interfaces a TS class or interface extends or implements.
    fn heritage(&mut self, oi: usize, n: Node) {
        for c in n.named_children(&mut n.walk()) {
            match c.kind() {
                "class_heritage" => self.heritage(oi, c),
                "extends_clause" | "implements_clause" | "extends_type_clause" => {
                    for t in c.named_children(&mut c.walk()).filter(|t| t.kind() != "type_arguments") {
                        let t = base(self.t(t));
                        self.objs[oi].impls.insert(t);
                    }
                }
                _ => {}
            }
        }
    }

    /// Adds the members in `body`; generic parameters of `owner` are not type references.
    fn members(&mut self, oi: usize, owner: Node, body: Option<Node>) {
        if let Some(b) = body {
            for c in b.named_children(&mut b.walk()) {
                let kind = match c.kind() {
                    "field_declaration" | "public_field_definition" | "property_signature" | "const_item" | "type_item"
                    | "associated_type" => MemberKind::Field,
                    "enum_variant" | "enum_assignment" | "property_identifier" => MemberKind::Variant,
                    "function_item" | "function_signature_item" | "method_definition" | "method_signature"
                    | "abstract_method_signature" => MemberKind::Method,
                    _ => continue,
                };
                let name = self.t(c.child_by_field_name("name").unwrap_or(c));
                if kind == MemberKind::Method {
                    self.add_member(oi, kind, c, name, c.child_by_field_name("body"));
                } else {
                    self.add_member(oi, kind, c, name, None);
                }
            }
        }
        if let Some(tp) = owner.child_by_field_name("type_parameters") {
            for nm in tp.named_children(&mut tp.walk()).filter_map(|p| p.child_by_field_name("name")) {
                let t = self.t(nm);
                let o = &mut self.objs[oi];
                o.refs.remove(t);
                o.members.iter_mut().for_each(|m| { m.types.remove(t); });
            }
        }
    }

    /// The type names used under `n`, for "has" arrows.
    fn type_names(&self, n: Node) -> BTreeSet<String> {
        let (mut stack, mut names) = (vec![n], BTreeSet::new());
        while let Some(n) = stack.pop() {
            if n.kind() == "type_identifier" {
                names.insert(self.t(n).into());
            }
            stack.extend(n.children(&mut n.walk()));
        }
        names
    }

    /// Adds a member; the signature is the text up to `body`, on one line.
    fn add_member(&mut self, oi: usize, kind: MemberKind, n: Node, name: &str, body: Option<Node>) {
        let end = body.map_or(n.end_byte(), |b| b.start_byte());
        let sig = self.src[n.start_byte()..end].split_whitespace().collect::<Vec<_>>().join(" ");
        let sig = sig.trim_end_matches([',', ';']).trim_end().into();
        let ((start, line, doc), mut calls) = (self.head(n), vec![]);
        let complexity = 1 + body.map_or(0, |b| self.calls(oi, b, &mut calls));
        let text = self.src[start..n.end_byte()].into();
        let types = if matches!(kind, MemberKind::Fn | MemberKind::Method) { self.unpacked(n).into_iter().chain(body.map(|b| self.uses(b)).unwrap_or_default()).collect() } else { self.type_names(n) };
        self.objs[oi].members.push(Mem { name: name.into(), kind, sig, text, doc, line, calls, complexity, types });
    }

    /// The types a function body really uses: values it reads, like `ChangeStatus::Removed` in Rust or
    /// `Kind.Foo` in TS, and type arguments it passes, like `get::<View>()` or `useState<Review>()`.
    /// Its signature doesn't count, and calls and constructions are "calls" and "creates" arrows instead.
    fn uses(&self, body: Node) -> BTreeSet<String> {
        let (mut stack, mut names) = (vec![body], BTreeSet::new());
        let called = |n: Node| n.parent().is_some_and(|p| p.kind() == "call_expression" && p.child_by_field_name("function") == Some(n));
        while let Some(n) = stack.pop() {
            let owner = match n.kind() {
                "scoped_identifier" if !called(n) => n.child_by_field_name("path"),
                "member_expression" if !called(n) => n.child_by_field_name("object").filter(|o| o.kind() == "identifier"),
                _ => None,
            };
            if let Some(t) = owner.map(|o| base(self.t(o))).filter(|t| t.starts_with(char::is_uppercase) && t != "Self") {
                names.insert(t);
            }
            if n.kind() == "type_arguments" && n.parent().is_some_and(|p| matches!(p.kind(), "generic_function" | "call_expression" | "new_expression")) {
                names.extend(self.type_names(n));
            }
            stack.extend(n.children(&mut n.walk()));
        }
        names
    }

    /// The types inside parameters a Rust function unpacks, like `View` in `Json(v): Json<View>`: the caller
    /// (often a framework) builds them for it, e.g. by decoding JSON, so the function really uses them.
    fn unpacked(&self, f: Node) -> BTreeSet<String> {
        let Some(ps) = f.child_by_field_name("parameters") else { return BTreeSet::new() };
        ps.named_children(&mut ps.walk())
            .filter(|p| p.child_by_field_name("pattern").is_some_and(|pat| pat.kind() == "tuple_struct_pattern"))
            .filter_map(|p| p.child_by_field_name("type")?.child_by_field_name("type_arguments"))
            .flat_map(|args| self.type_names(args))
            .collect()
    }

    /// Calls and JSX components inside `n` as (qualifier, name). The qualifier is "" for a free fn,
    /// else an object or module name (`self`/`Self`/`this` → enclosing object); calls on other values are skipped.
    /// A Rust struct literal or TS `new` gives ("new", type name). Returns the decision points inside `n`,
    /// nested closures and fns included.
    fn calls(&self, oi: usize, n: Node, out: &mut Vec<(String, String)>) -> u32 {
        let (mut stack, mut decisions) = (vec![n], 0);
        while let Some(n) = stack.pop() {
            decisions += u32::from(decision(n));
            let made = match n.kind() {
                "struct_expression" => n.child_by_field_name("name"),
                "new_expression" => n.child_by_field_name("constructor"),
                _ => None,
            };
            if let Some(t) = made.map(|t| base(self.t(t))) {
                out.push(("new".into(), if t == "Self" { self.objs[oi].name.clone() } else { t }));
            }
            let f = match n.kind() {
                "call_expression" => n.child_by_field_name("function"),
                "jsx_opening_element" | "jsx_self_closing_element" => n.child_by_field_name("name").filter(|f| !self.t(*f).starts_with(char::is_lowercase)),
                _ => None,
            };
            if let Some(t) = f.map(|f| self.t(f)) {
                let i = t.rfind(['.', ':']);
                let (q, name) = i.map_or(("", t), |i| (t[..i].trim_end_matches(':'), &t[i + 1..]));
                let q = match q {
                    "self" | "Self" | "this" => Some(self.objs[oi].name.clone()),
                    _ if i.is_some_and(|i| t[i..].starts_with('.')) => None,
                    q => Some(base(q)),
                };
                out.extend(q.map(|q| (q, name.into())));
            }
            stack.extend(n.children(&mut n.walk()));
        }
        decisions
    }
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
    fn rust_struct_impl_merge() {
        let src = "//! File doc.\n//!\n//! More.\nimpl Foo {\n    /// Makes one.\n    pub fn new(\n        x: u8,\n    ) -> Self { todo!() }\n    pub fn a(&self) -> u8 { 1 }\n}\nimpl fmt::Display for Foo<T> { fn fmt(&self) {} }\n/// The foo.\n/// Really.\n///\n/// Details.\n#[derive(\n    Debug,\n)]\npub struct Foo { pub a: Vec<Bar>, b: u8 }\nenum E { A(Baz), B }\nimpl Ext for Other {}\n// plain\nfn free() {}\n#[cfg(test)]\nmod tests { struct Hidden; }\n";
        let objs = extract("a.rs", src);
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
        let objs = extract("a.tsx", src);
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
            assert_eq!(extract(p, s)[0].doc, d);
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

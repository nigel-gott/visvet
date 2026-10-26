//! The names code mentions, for arrows: the types a field holds, the types a function's body uses, and the
//! functions it calls or the types it constructs.
use super::walk::FileParser;
use std::collections::BTreeSet;
use tree_sitter::Node;

/// Whether `n` adds a decision a reader must follow: a branch, loop, catch, `&&`/`||`/`??`, or a whole match or switch.
/// A match counts once, not per arm, so a flat dispatch over many cases stays simple; `?` only passes errors up.
pub(super) fn decision(n: Node) -> bool {
    let op = matches!(n.kind(), "&&" | "||" | "??") && n.parent().is_some_and(|p| matches!(p.kind(), "binary_expression" | "let_chain"));
    op || matches!(n.kind(), "if_expression" | "for_expression" | "while_expression" | "loop_expression" | "match_expression"
        | "if_statement" | "for_statement" | "for_in_statement" | "while_statement" | "do_statement" | "switch_statement" | "catch_clause" | "ternary_expression")
}

/// `fmt::Display` -> `Display`, `Foo<T>` -> `Foo`.
pub(super) fn base(s: &str) -> String {
    s.split('<').next().unwrap().rsplit([':', '.']).next().unwrap().trim().into()
}

/// Reading names: the types and functions code mentions, which become arrows.
impl FileParser<'_> {
    /// The type names used under `n`, for "has" arrows.
    pub(super) fn type_names(&self, n: Node) -> BTreeSet<String> {
        let (mut stack, mut names) = (vec![n], BTreeSet::new());
        while let Some(n) = stack.pop() {
            if n.kind() == "type_identifier" {
                names.insert(self.t(n).into());
            }
            stack.extend(n.children(&mut n.walk()));
        }
        names
    }

    /// The types a function body really uses: values it reads, like `ChangeStatus::Removed` in Rust or
    /// `Kind.Foo` in TS, and type arguments it passes, like `get::<View>()` or `useState<Review>()`.
    /// Its signature doesn't count, and calls and constructions are "calls" and "creates" arrows instead.
    pub(super) fn uses(&self, body: Node) -> BTreeSet<String> {
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
    pub(super) fn unpacked(&self, f: Node) -> BTreeSet<String> {
        let Some(ps) = f.child_by_field_name("parameters") else { return BTreeSet::new() };
        ps.named_children(&mut ps.walk())
            .filter(|p| p.child_by_field_name("pattern").is_some_and(|pat| pat.kind() == "tuple_struct_pattern"))
            .filter_map(|p| p.child_by_field_name("type")?.child_by_field_name("type_arguments"))
            .flat_map(|args| self.type_names(args))
            .collect()
    }

    /// Calls and JSX components inside `n` as (qualifier, name). The qualifier is "" for a free fn,
    /// else an object or module name (`self`/`Self`/`this` → enclosing unit); calls on other values are skipped.
    /// A Rust struct literal or TS `new` gives ("new", type name). Returns the decision points inside `n`,
    /// nested closures and fns included.
    pub(super) fn calls(&self, oi: usize, n: Node, out: &mut Vec<(String, String)>) -> u32 {
        let (mut stack, mut decisions) = (vec![n], 0);
        while let Some(n) = stack.pop() {
            decisions += u32::from(decision(n));
            let made = match n.kind() {
                "struct_expression" => n.child_by_field_name("name"),
                "new_expression" => n.child_by_field_name("constructor"),
                _ => None,
            };
            if let Some(t) = made.map(|t| base(self.t(t))) {
                out.push(("new".into(), if t == "Self" { self.units[oi].name.clone() } else { t }));
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
                    "self" | "Self" | "this" => Some(self.units[oi].name.clone()),
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

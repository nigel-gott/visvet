//! The names code mentions, for arrows: the types a field holds, the types a function's body uses, and the
//! functions it calls or the types it constructs.
use super::walk::{FileParser, line};
use super::Mention;
use std::collections::{BTreeSet, HashSet};
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

/// A path as code writes it, without spaces or generic arguments: "Vec" for `Vec<u8>`, "a::B::new" for
/// `a::B::<T>::new`. None for a path that starts from a cast, like `<T as Trait>::make`, which names no one thing.
pub(super) fn plain_path(text: &str) -> Option<String> {
    let (mut path, mut generic_depth) = (String::new(), 0);
    for letter in text.chars().filter(|letter| !letter.is_whitespace()) {
        match letter {
            '<' => generic_depth += 1,
            '>' => generic_depth -= 1,
            _ if generic_depth == 0 => path.push(letter),
            _ => {}
        }
    }
    let path = path.replace("::::", "::");
    let path = path.trim_end_matches(':');
    (!path.is_empty() && !path.starts_with(':')).then(|| path.to_string())
}

/// The syntax nodes that give names to values, with the field holding the pattern that names them: Rust's `let`,
/// parameters, `for`, `match` arms and `if let`; TypeScript's `const`/`let`, parameters and `catch`.
const BINDERS: [(&str, &str); 11] = [
    ("let_declaration", "pattern"), ("parameter", "pattern"), ("for_expression", "pattern"), ("match_arm", "pattern"),
    ("let_condition", "pattern"), ("variable_declarator", "name"), ("required_parameter", "pattern"),
    ("optional_parameter", "pattern"), ("arrow_function", "parameter"), ("catch_clause", "parameter"), ("for_in_statement", "left"),
];

/// Reading names: the types and functions code mentions, which become arrows.
impl FileParser<'_> {
    /// `n`'s text as a mention on `n`'s line, if it is a plain path (see `plain_path`).
    pub(super) fn mention(&self, n: Node) -> Option<Mention> {
        plain_path(self.t(n)).map(|path| Mention { path, line: line(n), as_head: false })
    }

    /// The types named under `n`, for "has" arrows: in Rust with their paths, like "fmt::Display".
    pub(super) fn type_names(&self, n: Node) -> BTreeSet<Mention> {
        let (mut stack, mut names) = (vec![n], BTreeSet::new());
        while let Some(n) = stack.pop() {
            if matches!(n.kind(), "type_identifier" | "scoped_type_identifier") {
                names.extend(self.mention(n));
            }
            // A path's own parts are not types of their own.
            if n.kind() != "scoped_type_identifier" {
                stack.extend(n.children(&mut n.walk()));
            }
        }
        names
    }

    /// The types a function body really uses: values it reads, like `ChangeStatus::Removed` in Rust or
    /// `Kind.Foo` in TS, and type arguments it passes, like `get::<View>()` or `useState<Review>()`.
    /// Its signature doesn't count, and calls and constructions are "calls" and "creates" arrows instead.
    pub(super) fn uses(&self, body: Node) -> BTreeSet<Mention> {
        let (mut stack, mut names) = (vec![body], BTreeSet::new());
        let called = |n: Node| n.parent().is_some_and(|p| p.kind() == "call_expression" && p.child_by_field_name("function") == Some(n));
        while let Some(n) = stack.pop() {
            let owner = match n.kind() {
                "scoped_identifier" if !called(n) => n.child_by_field_name("path"),
                "member_expression" if !called(n) => n.child_by_field_name("object").filter(|o| o.kind() == "identifier"),
                _ => None,
            };
            let is_a_type = |owner: &Mention| base(&owner.path).starts_with(char::is_uppercase) && owner.first_name() != "Self";
            names.extend(owner.and_then(|owner| self.mention(owner)).filter(is_a_type));
            if n.kind() == "type_arguments" && n.parent().is_some_and(|p| matches!(p.kind(), "generic_function" | "call_expression" | "new_expression")) {
                names.extend(self.type_names(n));
            }
            stack.extend(n.children(&mut n.walk()));
        }
        names
    }

    /// The types inside parameters a Rust function unpacks, like `View` in `Json(v): Json<View>`: the caller
    /// (often a framework) builds them for it, e.g. by decoding JSON, so the function really uses them.
    pub(super) fn unpacked(&self, f: Node) -> BTreeSet<Mention> {
        let Some(ps) = f.child_by_field_name("parameters") else { return BTreeSet::new() };
        ps.named_children(&mut ps.walk())
            .filter(|p| p.child_by_field_name("pattern").is_some_and(|pat| pat.kind() == "tuple_struct_pattern"))
            .filter_map(|p| p.child_by_field_name("type")?.child_by_field_name("type_arguments"))
            .flat_map(|args| self.type_names(args))
            .collect()
    }

    /// The names function `f` gives to its own values and generic types: parameters, `let`s, closure parameters,
    /// loop and match variables, and `<T>`. A mention starting with one of them means that local thing, never a
    /// function or type elsewhere that happens to share the name.
    pub(super) fn local_names(&self, f: Node) -> HashSet<&str> {
        let (mut stack, mut names) = (vec![f], HashSet::new());
        while let Some(n) = stack.pop() {
            let pattern_field = BINDERS.iter().find(|(binder, _)| *binder == n.kind()).map(|(_, field)| *field);
            if let Some(pattern) = pattern_field.and_then(|field| n.child_by_field_name(field)) {
                self.pattern_names(pattern, &mut names);
            }
            if n.kind() == "closure_parameters" {
                n.named_children(&mut n.walk()).for_each(|pattern| self.pattern_names(pattern, &mut names));
            }
            if matches!(n.kind(), "type_parameter" | "const_parameter") {
                names.extend(n.child_by_field_name("name").map(|name| self.t(name)));
            }
            stack.extend(n.children(&mut n.walk()));
        }
        names
    }

    /// Adds the names a pattern binds, like `a` and `b` in `Some((a, Point { b, .. }))`. The types it matches against
    /// (`Some`, `Point`), paths and a match arm's `if` condition bind nothing.
    fn pattern_names<'a>(&'a self, pattern: Node, names: &mut HashSet<&'a str>) {
        let mut stack = vec![pattern];
        while let Some(n) = stack.pop() {
            if matches!(n.kind(), "identifier" | "shorthand_field_identifier" | "shorthand_property_identifier_pattern") {
                names.insert(self.t(n));
            }
            let binds_nothing = [n.child_by_field_name("type"), n.child_by_field_name("condition")];
            let children: Vec<Node> = n.children(&mut n.walk()).collect();
            stack.extend(children.into_iter().filter(|child| child.kind() != "scoped_identifier" && !binds_nothing.contains(&Some(*child))));
        }
    }

    /// The function a call names, as a path: "show", "git::show" or "M::new"; a call on `self` or `this`, like
    /// `self.make()`, is "Self::make". None for a call on any other value, like `x.walk()`: its type isn't evident.
    fn callee(&self, function: Node) -> Option<Mention> {
        let function = if function.kind() == "generic_function" { function.child_by_field_name("function")? } else { function };
        let on_value = function.child_by_field_name("value").or(function.child_by_field_name("object"));
        match (function.kind(), on_value) {
            ("identifier" | "scoped_identifier", _) => self.mention(function),
            ("field_expression" | "member_expression", Some(value)) if matches!(self.t(value), "self" | "this") => {
                let method = function.child_by_field_name("field").or(function.child_by_field_name("property"))?;
                Some(Mention { path: format!("Self::{}", self.t(method)), line: line(function), as_head: false })
            }
            _ => None,
        }
    }

    /// Adds the calls and JSX components inside `n` to `calls` (see `callee`), and the types it builds, with a Rust
    /// struct literal or a TS `new`, to `creates`. Returns the decision points inside `n`, nested closures and fns included.
    pub(super) fn calls(&self, n: Node, calls: &mut Vec<Mention>, creates: &mut Vec<Mention>) -> u32 {
        let (mut stack, mut decisions) = (vec![n], 0);
        while let Some(n) = stack.pop() {
            decisions += u32::from(decision(n));
            let made = match n.kind() {
                "struct_expression" => n.child_by_field_name("name"),
                "new_expression" => n.child_by_field_name("constructor"),
                _ => None,
            };
            creates.extend(made.and_then(|made| self.mention(made)));
            let component = |name: &Node| name.kind() == "identifier" && !self.t(*name).starts_with(char::is_lowercase);
            let called = match n.kind() {
                "call_expression" => n.child_by_field_name("function"),
                "jsx_opening_element" | "jsx_self_closing_element" => n.child_by_field_name("name").filter(component),
                _ => None,
            };
            calls.extend(called.and_then(|called| self.callee(called)));
            stack.extend(n.children(&mut n.walk()));
        }
        decisions
    }
}

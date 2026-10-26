//! Walking one file's syntax tree: each top-level item, the types it declares and their members.
use super::{Mem, Obj, clean};
use crate::types::{MemberKind, UnitKind};
use tree_sitter::Node;

/// Extraction state for one file: its source, path and the objects found so far.
pub(super) struct Ex<'a> {
    pub(super) src: &'a str,
    pub(super) path: &'a str,
    pub(super) objs: Vec<Obj>,
}

/// The node's 1-based start line.
pub(super) fn line(n: Node) -> u32 {
    n.start_position().row as u32 + 1
}

/// The node, or the `export` statement around it (which also holds its decorators).
pub(super) fn outer(n: Node) -> Node {
    n.parent().filter(|p| p.kind() == "export_statement").unwrap_or(n)
}

/// The object kind of a type-declaring node kind, if it is one.
pub(super) fn type_kind(k: &str) -> Option<UnitKind> {
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

impl<'a> Ex<'a> {
    /// The node's source text.
    pub(super) fn t(&self, n: Node) -> &'a str {
        &self.src[n.byte_range()]
    }

    /// Where `n`'s text starts, that line's number, and its doc comment. The text takes in its
    /// `export`/decorators and the doc comment and attribute lines right above it, and starts at
    /// the beginning of its line unless other code precedes it there.
    pub(super) fn head(&self, n: Node) -> (usize, u32, String) {
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
    pub(super) fn obj(&mut self, name: &str, n: Node) -> usize {
        if let Some(i) = self.objs.iter().position(|o| o.name == name) {
            return i;
        }
        self.objs.push(Obj { name: name.into(), kind: UnitKind::Impl, line: line(n), ..Default::default() });
        self.objs.len() - 1
    }

    /// Handles one top-level item: imports, types, impls and free functions.
    pub(super) fn item(&mut self, n: Node) {
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

    /// Adds a struct, enum, trait, type alias, class or interface with its text, doc, heritage, type refs and members.
    pub(super) fn type_item(&mut self, n: Node, kind: UnitKind) {
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

    /// Adds the members in `body`; generic parameters of `owner` are not type references.
    pub(super) fn members(&mut self, oi: usize, owner: Node, body: Option<Node>) {
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

    /// Adds a member; the signature is the text up to `body`, on one line.
    pub(super) fn add_member(&mut self, oi: usize, kind: MemberKind, n: Node, name: &str, body: Option<Node>) {
        let end = body.map_or(n.end_byte(), |b| b.start_byte());
        let sig = self.src[n.start_byte()..end].split_whitespace().collect::<Vec<_>>().join(" ");
        // A struct-like enum variant's signature stops at its name, e.g. "Threads", not its whole field list; More shows the fields.
        let sig = if kind == MemberKind::Variant { sig.split(" {").next().unwrap_or(&sig).to_string() } else { sig };
        let sig = sig.trim_end_matches([',', ';']).trim_end().into();
        let ((start, line, doc), mut calls) = (self.head(n), vec![]);
        let complexity = 1 + body.map_or(0, |b| self.calls(oi, b, &mut calls));
        let text = self.src[start..n.end_byte()].into();
        let types = if matches!(kind, MemberKind::Fn | MemberKind::Method) { self.unpacked(n).into_iter().chain(body.map(|b| self.uses(b)).unwrap_or_default()).collect() } else { self.type_names(n) };
        self.objs[oi].members.push(Mem { name: name.into(), kind, sig, text, doc, line, calls, complexity, types });
    }
}

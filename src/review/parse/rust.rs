//! What only Rust has: `use` imports, with the path each name is written as, and `impl` blocks.
use super::names::base;
use super::walk::{FileParser, line};
use super::{EVERY_NAME, Import};
use tree_sitter::Node;

/// What only Rust has: `use` imports and `impl` blocks.
impl FileParser<'_> {
    /// Records each name a Rust `use` brings into scope, with the path it is written as.
    pub(super) fn rust_use(&mut self, use_item: Node) {
        let Some(imported) = use_item.child_by_field_name("argument") else { return };
        let mut imports = vec![];
        self.use_tree(imported, &[], &mut imports);
        self.boxes[0].imports.extend(imports);
    }

    /// Adds the imports of one part of a `use`, written after the path `prefix`: a path (`a::B`), a rename
    /// (`a::B as C`), a glob (`a::*`) or a list (`a::{B, c::D, self}`), whose parts are read the same way.
    fn use_tree(&self, part: Node, prefix: &[String], imports: &mut Vec<Import>) {
        let extended = |path: Option<Node>| -> Vec<String> {
            let written = path.map_or("", |path| self.t(path));
            prefix.iter().cloned().chain(written.split("::").map(str::trim).filter(|name| !name.is_empty()).map(String::from)).collect()
        };
        let mut import = |mut path: Vec<String>, renamed: Option<String>| {
            // `a::{self}` imports `a` itself.
            if path.last().is_some_and(|last| last == "self") && path.len() > 1 {
                path.pop();
            }
            let Some(name) = renamed.or(path.last().cloned()) else { return };
            imports.push(Import { name, path, files: vec![], line: line(part) });
        };
        match part.kind() {
            "use_list" => part.named_children(&mut part.walk()).for_each(|inner| self.use_tree(inner, prefix, imports)),
            "scoped_use_list" => {
                let Some(list) = part.child_by_field_name("list") else { return };
                self.use_tree(list, &extended(part.child_by_field_name("path")), imports);
            }
            "use_as_clause" => import(extended(part.child_by_field_name("path")), part.child_by_field_name("alias").map(|alias| self.t(alias).to_string())),
            "use_wildcard" => import(extended(part.named_child(0)), Some(EVERY_NAME.into())),
            _ => import(extended(Some(part)), None),
        }
    }

    /// Adds a Rust impl block's methods, and its trait, to the box for its type.
    pub(super) fn rust_impl(&mut self, n: Node) {
        let Some(ty) = n.child_by_field_name("type") else { return };
        let oi = self.box_index(&base(self.t(ty)), n);
        if let Some(implemented) = n.child_by_field_name("trait").and_then(|implemented| self.mention(implemented)) {
            self.boxes[oi].impls.insert(implemented);
        }
        self.members(oi, n, n.child_by_field_name("body"));
    }
}

#[cfg(test)]
mod tests {
    use crate::review::parse::parse;
    use crate::types::RepoPath;

    #[test]
    fn each_imported_name_keeps_its_whole_path() {
        let source = "use std::fmt;\nuse crate::types::{MapBox, ids::{self, BoxId as Id}, boxes::*};\npub use super::walk;\nmod inner;\nmod tests { }\n";
        let file = &parse(&RepoPath("src/a.rs".into()), source)[0];
        let imports: Vec<(String, String)> = file.imports.iter().map(|import| (import.name.clone(), import.path.join("::"))).collect();
        let expected = [("fmt", "std::fmt"), ("MapBox", "crate::types::MapBox"), ("ids", "crate::types::ids"), ("Id", "crate::types::ids::BoxId"),
            ("*", "crate::types::boxes"), ("walk", "super::walk")];
        assert_eq!(imports, expected.map(|(name, path)| (name.to_string(), path.to_string())));
        assert_eq!(file.mods, ["inner"]);
    }
}

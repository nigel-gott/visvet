//! What only Rust has: `use crate::...` imports and `impl` blocks.
use super::names::base;
use super::walk::FileParser;
use super::join;
use crate::types::RepoPath;
use tree_sitter::Node;

/// What only Rust has: `use crate::...` imports and `impl` blocks.
impl FileParser<'_> {
    /// Records the files of the crate modules a Rust `use crate::...` names.
    pub(super) fn rust_use(&mut self, n: Node) {
        let Some(a) = n.child_by_field_name("argument") else { return };
        let krate = self.path.src_folder().unwrap_or(self.path.folder());
        let list = a.child_by_field_name("list").filter(|_| a.child_by_field_name("path").is_some_and(|p| self.t(p) == "crate"));
        let items: Vec<&str> = match list {
            Some(l) => l.named_children(&mut l.walk()).map(|c| self.t(c)).collect(),
            None => self.t(a).strip_prefix("crate::").into_iter().collect(),
        };
        for m in items {
            let p = join(krate, m.split([':', ' ']).next().unwrap());
            self.boxes[0].uses.push(vec![p.with_suffix(".rs"), RepoPath(p.0.join("mod.rs"))]);
        }
    }

    /// Adds a Rust impl block's methods, and its trait, to the box for its type.
    pub(super) fn rust_impl(&mut self, n: Node) {
        let Some(ty) = n.child_by_field_name("type") else { return };
        let oi = self.box_index(&base(self.t(ty)), n);
        if let Some(tr) = n.child_by_field_name("trait") {
            let tr = base(self.t(tr));
            self.boxes[oi].impls.insert(tr);
        }
        self.members(oi, n, n.child_by_field_name("body"));
    }
}

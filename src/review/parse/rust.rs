//! What only Rust has: `use crate::...` imports and `impl` blocks.
use super::names::base;
use super::walk::FileParser;
use crate::types::RepoPath;
use std::path::{Path, PathBuf};
use tree_sitter::Node;

/// What only Rust has: `use crate::...` imports and `impl` blocks.
impl FileParser<'_> {
    /// Records the files of the crate modules a Rust `use crate::...` names.
    pub(super) fn rust_use(&mut self, use_item: Node) {
        let Some(imported) = use_item.child_by_field_name("argument") else { return };
        let crate_src = self.path.src_folder().unwrap_or(self.path.folder());
        let is_crate = |path: Node| self.t(path) == "crate";
        let list = imported.child_by_field_name("list").filter(|_| imported.child_by_field_name("path").is_some_and(is_crate));
        let names: Vec<&str> = match list {
            Some(list) => list.named_children(&mut list.walk()).map(|name| self.t(name)).collect(),
            None => self.t(imported).strip_prefix("crate::").into_iter().collect(),
        };
        for name in names {
            self.boxes[0].uses.push(module_files(crate_src, name));
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

/// The files that may hold the module a name from `use crate::...` is in, innermost first: for
/// `review::parse::join`, "review/parse/join.rs", "review/parse.rs", then "review.rs", each also as a folder's
/// `mod.rs`, inside `crate_src`. The first that exists is the one imported, so a name inside a module points at
/// that module's own file, not at its parent's.
fn module_files(crate_src: &Path, name: &str) -> Vec<RepoPath> {
    let path = name.split([' ', '{']).next().unwrap_or("");
    let modules: Vec<&str> = path.split("::").filter(|module| !module.is_empty()).collect();
    (1..=modules.len()).rev().flat_map(|depth| {
        let module = RepoPath(crate_src.join(modules[..depth].iter().collect::<PathBuf>()));
        [module.with_suffix(".rs"), RepoPath(module.0.join("mod.rs"))]
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_name_points_at_its_innermost_module_first() {
        let files = |name| module_files(Path::new("src"), name).iter().map(|f| f.to_string()).collect::<Vec<_>>();
        assert_eq!(files("review::parse::{ParsedBox, parse}"), ["src/review/parse.rs", "src/review/parse/mod.rs", "src/review.rs", "src/review/mod.rs"]);
        assert_eq!(files("types"), ["src/types.rs", "src/types/mod.rs"]);
    }
}

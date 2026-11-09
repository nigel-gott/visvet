//! What only Rust has: `use` imports of this crate's and sibling crates' modules, and `impl` blocks.
use super::names::base;
use super::walk::FileParser;
use crate::types::RepoPath;
use std::path::{Path, PathBuf};
use tree_sitter::Node;

/// What only Rust has: `use` imports of this crate's and sibling crates' modules, and `impl` blocks.
impl FileParser<'_> {
    /// Records the files of the modules a Rust `use crate::...` or `use other_crate::...` names.
    pub(super) fn rust_use(&mut self, use_item: Node) {
        let Some(imported) = use_item.child_by_field_name("argument") else { return };
        let Some((root, rest)) = self.t(imported).split_once("::") else { return };
        let crate_srcs = self.crate_srcs(root);
        if crate_srcs.is_empty() {
            return;
        }
        let is_root = |path: Node| self.t(path) == root;
        let list = imported.child_by_field_name("list").filter(|_| imported.child_by_field_name("path").is_some_and(is_root));
        let names: Vec<&str> = match list {
            Some(list) => list.named_children(&mut list.walk()).map(|name| self.t(name)).collect(),
            None => vec![rest],
        };
        for name in names {
            self.boxes[0].uses.push(crate_srcs.iter().flat_map(|crate_src| module_files(crate_src, name)).collect());
        }
    }

    /// The `src` folders that may hold the crate a `use` path starts with: this file's own for `crate`, none for
    /// `self` and `super`, else a sibling crate's in the same workspace folder, e.g. `crates/client-core/src` or
    /// `crates/client_core/src` for `client_core` used from `crates/sim/src/lib.rs`.
    fn crate_srcs(&self, root: &str) -> Vec<PathBuf> {
        let own_src = self.path.src_folder().unwrap_or(self.path.folder());
        match root {
            "crate" => vec![own_src.into()],
            "self" | "super" => vec![],
            // ponytail: assumes a crate's folder is named after it, as cargo new does; read each Cargo.toml's
            // package name if a workspace breaks that.
            other_crate => {
                let Some(workspace) = self.path.src_folder().and_then(Path::parent).and_then(Path::parent) else { return vec![] };
                let folder_names = [other_crate.replace('_', "-"), other_crate.to_string()];
                folder_names.iter().map(|folder_name| workspace.join(folder_name).join("src")).collect()
            }
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

/// The files that may hold the module a name from a `use` is in, innermost first: for `review::parse::join`,
/// "review/parse/join.rs", "review/parse.rs", then "review.rs", each also as a folder's `mod.rs`, inside
/// `crate_src`, and last the crate root, `lib.rs` or `main.rs`. The first that exists is the one imported, so a name
/// inside a module points at that module's own file, not at its parent's, and a name the crate root holds or
/// re-exports points at the root.
fn module_files(crate_src: &Path, name: &str) -> Vec<RepoPath> {
    let path = name.split([' ', '{']).next().unwrap_or("");
    let modules: Vec<&str> = path.split("::").filter(|module| !module.is_empty()).collect();
    let module_files = (1..=modules.len()).rev().flat_map(|depth| {
        let module = RepoPath(crate_src.join(modules[..depth].iter().collect::<PathBuf>()));
        [module.with_suffix(".rs"), RepoPath(module.0.join("mod.rs"))]
    });
    let crate_roots = ["lib.rs", "main.rs"].map(|root_file| RepoPath(crate_src.join(root_file)));
    module_files.chain(crate_roots).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::parse::parse;

    #[test]
    fn a_name_points_at_its_innermost_module_first() {
        let files = |name| module_files(Path::new("src"), name).iter().map(|f| f.to_string()).collect::<Vec<_>>();
        assert_eq!(files("review::parse::{ParsedBox, parse}"), ["src/review/parse.rs", "src/review/parse/mod.rs", "src/review.rs", "src/review/mod.rs", "src/lib.rs", "src/main.rs"]);
        assert_eq!(files("types"), ["src/types.rs", "src/types/mod.rs", "src/lib.rs", "src/main.rs"]);
    }

    #[test]
    fn a_sibling_crate_in_the_workspace_is_imported_from_its_folder() {
        let file = RepoPath("crates/sim/src/motion.rs".into());
        let uses = &parse(&file, "use client_core::{Clock, mirror::World};\nuse self::inner::X;\n")[0].uses;
        let first_files: Vec<String> = uses.iter().map(|candidates| candidates[0].to_string()).collect();
        assert_eq!(first_files, ["crates/client-core/src/Clock.rs", "crates/client-core/src/mirror/World.rs"]);
        assert!(uses[0].contains(&RepoPath("crates/client-core/src/lib.rs".into())));
        assert!(uses[1].contains(&RepoPath("crates/client_core/src/mirror.rs".into())));
    }
}

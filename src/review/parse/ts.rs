//! What only TypeScript has: relative imports, `const f = () => ...` functions, and `extends`/`implements`.
use super::names::base;
use super::walk::FileParser;
use super::join;
use crate::types::{MemberKind, RepoPath};
use tree_sitter::Node;

/// What only TypeScript has: relative imports, `const f = () => ...` functions, `extends` and `implements`.
impl FileParser<'_> {
    /// Records a TS import or re-export from relative module `s`, as candidate files.
    pub(super) fn ts_import(&mut self, s: Node) {
        let spec = self.t(s).trim_matches(['\'', '"']);
        if spec.starts_with('.') {
            let p = join(self.path.folder(), spec);
            let files = ["", ".ts", ".tsx"].map(|ext| p.with_suffix(ext)).into_iter();
            self.boxes[0].uses.push(files.chain(["index.ts", "index.tsx"].map(|index| RepoPath(p.0.join(index)))).collect());
        }
    }

    /// Adds `const f = () => ...` and `const f = function ...` declarations as free fns.
    pub(super) fn const_fns(&mut self, n: Node) {
        for d in n.named_children(&mut n.walk()) {
            let (Some(nm), Some(v)) = (d.child_by_field_name("name"), d.child_by_field_name("value")) else { continue };
            if matches!(v.kind(), "arrow_function" | "function_expression" | "function") {
                self.add_member(0, MemberKind::Fn, n, self.t(nm), v.child_by_field_name("body"));
            }
        }
    }

    /// Records the base classes and interfaces a TS class or interface extends or implements.
    pub(super) fn heritage(&mut self, oi: usize, n: Node) {
        for c in n.named_children(&mut n.walk()) {
            match c.kind() {
                "class_heritage" => self.heritage(oi, c),
                "extends_clause" | "implements_clause" | "extends_type_clause" => {
                    for t in c.named_children(&mut c.walk()).filter(|t| t.kind() != "type_arguments") {
                        let t = base(self.t(t));
                        self.boxes[oi].impls.insert(t);
                    }
                }
                _ => {}
            }
        }
    }
}

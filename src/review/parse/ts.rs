//! What only TypeScript has: relative imports, `const f = () => ...` functions, and `extends`/`implements`.
use super::walk::{FileParser, line};
use super::names::base;
use super::{EVERY_NAME, Import, Mention, join};
use crate::types::{MemberKind, RepoPath};
use tree_sitter::Node;

/// What only TypeScript has: relative imports, `const f = () => ...` functions, `extends` and `implements`.
impl FileParser<'_> {
    /// Records the names a TS import or re-export (`statement`) takes from relative module `source`, with the files
    /// that module may be: `import D, { a, b as c } from './x'`, `import * as x from './x'`, `export * from './x'`.
    /// A bare `import './style.css'` records the file alone, under no name.
    pub(super) fn ts_import(&mut self, statement: Node, source: Node) {
        let spec = self.t(source).trim_matches(['\'', '"']);
        if !spec.starts_with('.') {
            return;
        }
        let module = join(self.path.folder(), spec);
        let as_file = ["", ".ts", ".tsx"].map(|ext| module.with_suffix(ext)).into_iter();
        let files: Vec<RepoPath> = as_file.chain(["index.ts", "index.tsx"].map(|index| RepoPath(module.0.join(index)))).collect();
        let mut names: Vec<(String, Vec<String>)> = vec![];
        let (mut stack, mut exports_all) = (vec![statement], false);
        while let Some(n) = stack.pop() {
            let renamed = n.child_by_field_name("alias").or(n.child_by_field_name("name")).map(|name| self.t(name).to_string());
            match n.kind() {
                "import_specifier" | "export_specifier" => names.extend(renamed.zip(n.child_by_field_name("name").map(|name| vec![self.t(name).to_string()]))),
                "namespace_import" | "namespace_export" => names.extend(n.named_child(0).map(|name| (self.t(name).to_string(), vec![]))),
                "identifier" if n.parent().is_some_and(|parent| parent.kind() == "import_clause") => names.push((self.t(n).into(), vec!["default".into()])),
                "*" => exports_all = n.parent() == Some(statement),
                _ => {}
            }
            stack.extend(n.children(&mut n.walk()));
        }
        if exports_all {
            names.push((EVERY_NAME.into(), vec![]));
        }
        if names.is_empty() {
            names.push((String::new(), vec![]));
        }
        let line = line(statement);
        self.boxes[0].imports.extend(names.into_iter().map(|(name, path)| Import { name, path, files: files.clone(), line }));
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
                        let extended = Mention { path: base(self.t(t)), line: line(t) };
                        self.boxes[oi].impls.insert(extended);
                    }
                }
                _ => {}
            }
        }
    }
}

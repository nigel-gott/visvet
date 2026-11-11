//! The Cargo packages in the repository, read from their `Cargo.toml` files: where each one's crates start, and which
//! other packages it depends on. Cargo's rules, not names that happen to match, decide which crate Rust code can use.
use crate::review::parse::join;
use crate::types::RepoPath;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::path::Path;
use toml::{Table, Value};

/// A `Cargo.toml` file and its text.
pub struct Manifest {
    pub file: RepoPath,
    pub text: String,
}

/// Which package of a `Workspace`: its place in `Workspace::packages`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct PackageId(pub usize);

/// One Cargo package: a folder whose `Cargo.toml` has a `[package]`.
#[derive(Debug)]
pub struct Package {
    pub manifest: RepoPath,
    /// The files its crates start at: the library first, then its programs, tests, examples and benches.
    pub crate_roots: Vec<RepoPath>,
    /// The file its library starts at (`src/lib.rs` unless the manifest says otherwise), if it has one.
    pub library: Option<RepoPath>,
    /// The name code uses for its library, e.g. "client_core".
    pub library_name: String,
    /// The packages in this repository it depends on (normal, dev and build dependencies alike), by the name its
    /// code uses for each.
    pub depends_on: BTreeMap<String, PackageId>,
}

/// Every Cargo package in the repository.
#[derive(Default, Debug)]
pub struct Workspace {
    pub packages: Vec<Package>,
}

/// The sections of a manifest that list dependencies.
// ponytail: `[target.'cfg(..)'.dependencies]` are not read; add them if a repo keeps in-repo crates there.
const DEPENDENCY_SECTIONS: [&str; 3] = ["dependencies", "dev-dependencies", "build-dependencies"];
/// The sections that declare a crate other than the library, each of which may name its root file with `path`.
const CRATE_SECTIONS: [&str; 4] = ["bin", "test", "example", "bench"];
/// The folders Cargo looks in for crates nobody declared: each `.rs` file, or folder with a `main.rs`, is one.
const CRATE_FOLDERS: [&str; 4] = ["src/bin", "tests", "examples", "benches"];

/// A manifest that parsed, with the folder it is in.
struct Read<'a> {
    file: &'a RepoPath,
    manifest: Table,
}

impl Workspace {
    /// Reads the packages from every `Cargo.toml` in `manifests`; `files` are the repository's current files.
    pub fn read(manifests: &[Manifest], files: &HashSet<RepoPath>) -> Workspace {
        let read: Vec<Read> = manifests.iter().filter_map(|manifest| Some(Read { file: &manifest.file, manifest: manifest.text.parse().ok()? })).collect();
        let name_of = |read: &Read| Some(read.manifest.get("package")?.get("name")?.as_str()?.to_string());
        let with_package: Vec<(&Read, String)> = read.iter().filter_map(|read| Some((read, name_of(read)?))).collect();
        let library_name = |read: &Read, name: &str| {
            let declared = read.manifest.get("lib").and_then(|library| library.get("name")).and_then(Value::as_str);
            declared.unwrap_or(name).replace('-', "_")
        };
        let package_in = |folder: &Path| with_package.iter().position(|(read, _)| read.file.folder() == folder).map(PackageId);
        let packages = with_package.iter().map(|(package, name)| {
            let mut depends_on = BTreeMap::new();
            for section in DEPENDENCY_SECTIONS {
                let listed = package.manifest.get(section).and_then(Value::as_table);
                for (key, dependency) in listed.into_iter().flatten() {
                    let Some(on) = dependency_folder(package.file, key, dependency, &read).and_then(|folder| package_in(&folder.0)) else { continue };
                    // A dependency renamed with `package = "..."` is used by its key; any other by its library's name.
                    let (on_read, on_name) = &with_package[on.0];
                    let name_in_code = if dependency.get("package").is_some() { key.replace('-', "_") } else { library_name(on_read, on_name) };
                    depends_on.insert(name_in_code, on);
                }
            }
            let library = library_root(package.file.folder(), &package.manifest);
            Package {
                manifest: package.file.clone(),
                crate_roots: crate_roots(package.file.folder(), &package.manifest, &library, files),
                library: Some(library).filter(|library| files.contains(library)),
                library_name: library_name(package, name),
                depends_on,
            }
        }).collect();
        Workspace { packages }
    }

    /// The package `file` belongs to: the innermost package folder it is in.
    pub fn package_of(&self, file: &RepoPath) -> Option<PackageId> {
        let holding = self.packages.iter().enumerate().filter(|(_, package)| file.0.starts_with(package.manifest.folder()));
        holding.max_by_key(|(_, package)| package.manifest.folder().components().count()).map(|(index, _)| PackageId(index))
    }

    /// Whether Cargo lets code in package `from` use package `to`: they are the same, or `from` depends on `to`,
    /// directly or through other packages.
    pub fn allows(&self, from: PackageId, to: PackageId) -> bool {
        let (mut reached, mut to_visit) = (BTreeSet::from([from]), vec![from]);
        while let Some(package) = to_visit.pop() {
            to_visit.extend(self.packages[package.0].depends_on.values().copied().filter(|next| reached.insert(*next)));
        }
        reached.contains(&to)
    }
}

/// The folder of the package that dependency `key` of the manifest `file` names, if it is given by a path: its own
/// `path = "../x"`, or with `workspace = true`, the path the workspace's root manifest gives for `key`.
fn dependency_folder(file: &RepoPath, key: &str, dependency: &Value, read: &[Read]) -> Option<RepoPath> {
    if let Some(path) = dependency.get("path").and_then(Value::as_str) {
        return Some(join(file.folder(), path));
    }
    dependency.get("workspace").and_then(Value::as_bool).filter(|inherits| *inherits)?;
    let is_root_above = |root: &&Read| root.manifest.contains_key("workspace") && file.0.starts_with(root.file.folder());
    let root = read.iter().filter(is_root_above).max_by_key(|root| root.file.folder().components().count())?;
    let path = root.manifest.get("workspace")?.get("dependencies")?.get(key)?.get("path")?.as_str()?;
    Some(join(root.file.folder(), path))
}

/// Where the library of the package in `folder` starts: its `[lib]`'s `path`, or `src/lib.rs`. The file may not exist.
fn library_root(folder: &Path, manifest: &Table) -> RepoPath {
    let declared = manifest.get("lib").and_then(|library| library.get("path")).and_then(Value::as_str);
    join(folder, declared.unwrap_or("src/lib.rs"))
}

/// The files the crates of the package in `folder` start at, of those that exist: the `library` first, then the
/// ones its manifest declares with `path`, Cargo's defaults (`src/main.rs`, `build.rs`), and each file Cargo finds
/// in `CRATE_FOLDERS`.
fn crate_roots(folder: &Path, manifest: &Table, library: &RepoPath, files: &HashSet<RepoPath>) -> Vec<RepoPath> {
    let declared = CRATE_SECTIONS.iter().flat_map(|section| match manifest.get(*section) {
        Some(Value::Array(crates)) => crates.iter().collect(),
        Some(one_crate) => vec![one_crate],
        None => vec![],
    }).filter_map(|one_crate| Some(join(folder, one_crate.get("path")?.as_str()?)));
    let defaults = ["src/main.rs", "build.rs"].map(|default| join(folder, default));
    let is_found_by_cargo = |file: &&RepoPath| CRATE_FOLDERS.iter().any(|crate_folder| {
        let Ok(inside) = file.0.strip_prefix(folder.join(crate_folder)) else { return false };
        let parts = inside.components().count();
        file.is_rust() && (parts == 1 || parts == 2 && inside.ends_with("main.rs"))
    });
    let found: BTreeSet<RepoPath> = files.iter().filter(is_found_by_cargo).cloned().collect();
    let mut roots: Vec<RepoPath> = vec![];
    for root in [library.clone()].into_iter().chain(declared).chain(defaults).chain(found).filter(|root| files.contains(root)) {
        if !roots.contains(&root) {
            roots.push(root);
        }
    }
    roots
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packages_roots_and_what_cargo_allows() {
        let manifests = [
            ("Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n[workspace.dependencies]\nport-kit = { path = \"crates/port-kit\" }\nserde = \"1\""),
            ("crates/app/Cargo.toml", "[package]\nname = \"app\"\n[[bin]]\nname = \"tool\"\npath = \"tools/tool.rs\"\n[dependencies]\nport-kit.workspace = true\nserde.workspace = true\n[dev-dependencies]\nrenamed = { path = \"../leaf\", package = \"leaf\" }"),
            ("crates/port-kit/Cargo.toml", "[package]\nname = \"port-kit\"\n[lib]\nname = \"ports\"\n[dependencies]\nleaf = { path = \"../leaf\" }"),
            ("crates/leaf/Cargo.toml", "[package]\nname = \"leaf\""),
        ].map(|(file, text)| Manifest { file: RepoPath(file.into()), text: text.into() });
        let files = ["crates/app/src/lib.rs", "crates/app/src/main.rs", "crates/app/tools/tool.rs", "crates/app/tests/it.rs", "crates/app/tests/big/main.rs",
            "crates/app/tests/big/helper.rs", "crates/port-kit/src/lib.rs", "crates/leaf/src/lib.rs"].map(|file| RepoPath(file.into())).into();
        let workspace = Workspace::read(&manifests, &files);
        let (app, ports, leaf) = (&workspace.packages[0], &workspace.packages[1], &workspace.packages[2]);
        let roots: Vec<&str> = app.crate_roots.iter().map(RepoPath::as_str).collect();
        assert_eq!(roots, ["crates/app/src/lib.rs", "crates/app/tools/tool.rs", "crates/app/src/main.rs", "crates/app/tests/big/main.rs", "crates/app/tests/it.rs"]);
        assert_eq!(app.depends_on, BTreeMap::from([("ports".to_string(), PackageId(1)), ("renamed".to_string(), PackageId(2))]));
        assert_eq!((ports.library_name.as_str(), ports.depends_on.keys().map(String::as_str).collect::<Vec<_>>(), leaf.depends_on.len()), ("ports", vec!["leaf"], 0));
        assert_eq!(workspace.package_of(&RepoPath("crates/leaf/src/deep/x.rs".into())), Some(PackageId(2)));
        assert_eq!(workspace.package_of(&RepoPath("docs/x.rs".into())), None);
        // app -> port-kit -> leaf, never back.
        assert!(workspace.allows(PackageId(0), PackageId(2)) && workspace.allows(PackageId(1), PackageId(2)));
        assert!(!workspace.allows(PackageId(2), PackageId(0)) && !workspace.allows(PackageId(1), PackageId(0)));
    }
}

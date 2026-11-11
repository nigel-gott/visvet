//! Working out what a name in the code means by the language's own rules, never by guessing: the file's imports, the
//! module the file is, and for Rust the crates its package depends on. A name that can't be traced this way (one from
//! the standard library or an outside crate, a method called on a value) means nothing here, and gets no arrow.
use super::cargo::{PackageId, Workspace};
use super::compare::Parsed;
use super::parse::{EVERY_NAME, Import};
use crate::types::{BoxKind, ChangeStatus, MapBox, Member, MemberKind, RepoPath};
use std::cell::RefCell;
use std::collections::HashMap;

/// Which module of a `Resolver`: its place in `Resolver::modules`.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub struct ModuleId(usize);

/// A place names live in: a Rust module or a TypeScript file. Each parsed file is one.
struct Module<'a> {
    file: &'a RepoPath,
    /// Rust, in a Cargo package: the package, set once the module is found from one of its crate roots.
    package: Option<PackageId>,
    /// The module `crate::` means here; itself for a crate's root, and for a file in no crate.
    crate_root: ModuleId,
    /// The module `super::` means here, if any.
    parent: Option<ModuleId>,
    /// The modules it declares in other files (`mod parse;`), by name.
    children: HashMap<&'a str, ModuleId>,
    types: HashMap<&'a str, &'a MapBox>,
    functions: HashMap<&'a str, Function<'a>>,
    imports: &'a [Import],
}

/// A function or method, and the module whose file it is in.
#[derive(Clone, Copy)]
pub struct Function<'a> {
    pub member: &'a Member,
    module: ModuleId,
}

/// What a name means: a module, a type's box, or a function or method.
#[derive(Clone, Copy)]
pub enum Found<'a> {
    Module(ModuleId),
    Type(&'a MapBox),
    Function(Function<'a>),
    /// Something from a package the code's own package doesn't depend on, reached through this module of one it
    /// does depend on, which re-exports it. The code knows only this module, so the arrow ends at its file.
    PassedOn(ModuleId),
}

/// What kind of thing a name is expected to be, where it is used.
#[derive(Clone, Copy, PartialEq, Eq, Hash)]
enum Want {
    /// Something that holds other names (a module, or a type with methods and variants): any part of a path but the last.
    Holder,
    Type,
    /// A function; else a type, called to build it, like `Wrapper(x)`.
    Callable,
    /// Whatever has the name, as a `use` takes it.
    Anything,
}

/// One lookup the resolver has done, or is doing: a name, looked for in a module.
type Lookup = (ModuleId, String, Want);

/// Resolves the names in the code of all the parsed files.
pub struct Resolver<'a> {
    workspace: &'a Workspace,
    modules: Vec<Module<'a>>,
    module_of: HashMap<&'a RepoPath, ModuleId>,
    /// Each type's methods by name, from its own box and every `impl` of it in other files, by the type's box id.
    methods: HashMap<&'a str, HashMap<&'a str, Function<'a>>>,
    /// Lookups already done. One still under way counts as finding nothing, which stops imports that go in circles.
    looked_up: RefCell<HashMap<Lookup, Option<Found<'a>>>>,
}

/// How many imports and re-exports a name is followed through before giving up.
const MOST_HOPS: usize = 8;

impl<'a> Resolver<'a> {
    /// Sets up the modules of `all` the parsed boxes: one per parsed file, and for Rust, linked into the module tree of
    /// each crate of `workspace` by following `mod` declarations down from the crate's root. Removed code is left out.
    pub fn new(all: &'a [Parsed], workspace: &'a Workspace) -> Self {
        let mut resolver = Resolver { workspace, modules: vec![], module_of: HashMap::new(), methods: HashMap::new(), looked_up: RefCell::default() };
        let live = || all.iter().filter(|parsed| parsed.map_box.status != ChangeStatus::Removed);
        let mut declared_modules: Vec<&'a [String]> = vec![];
        for parsed in live().filter(|parsed| parsed.map_box.kind() == BoxKind::File && parsed.map_box.language.is_parsed()) {
            let (id, file_box) = (ModuleId(resolver.modules.len()), &parsed.map_box);
            let functions = file_box.members().iter().filter(|member| member.kind == MemberKind::Fn && member.status != ChangeStatus::Removed);
            resolver.modules.push(Module {
                file: &file_box.file, package: None, crate_root: id, parent: None, children: HashMap::new(), types: HashMap::new(),
                functions: functions.map(|member| (member.name.as_str(), Function { member, module: id })).collect(), imports: &parsed.imports,
            });
            resolver.module_of.insert(&file_box.file, id);
            declared_modules.push(&parsed.mods);
        }
        let types = || live().map(|parsed| &parsed.map_box).filter(|map_box| map_box.kind() != BoxKind::File);
        for type_box in types().filter(|type_box| type_box.kind() != BoxKind::Impl) {
            if let Some(module) = resolver.module_of.get(&type_box.file) {
                resolver.modules[module.0].types.insert(&type_box.name, type_box);
            }
        }
        for (index, package) in workspace.packages.iter().enumerate() {
            let crate_roots: Vec<ModuleId> = package.crate_roots.iter().filter_map(|root| resolver.module_of.get(root).copied()).collect();
            for crate_root in crate_roots {
                resolver.grow_crate(crate_root, PackageId(index), &declared_modules);
            }
        }
        for type_box in types() {
            let (Some(of_type), Some(module)) = (resolver.own_type(type_box), resolver.module_of.get(&type_box.file).copied()) else { continue };
            let methods = type_box.members().iter().filter(|member| member.kind == MemberKind::Method && member.status != ChangeStatus::Removed);
            let known = resolver.methods.entry(of_type.id.as_str()).or_default();
            methods.for_each(|member| _ = known.entry(member.name.as_str()).or_insert(Function { member, module }));
        }
        resolver
    }

    /// Links the modules of the crate that starts at `crate_root`, in `package`: each `mod name;` a module declares
    /// is the file `name.rs` or `name/mod.rs` beside it, or in the folder named after it. A file two crates declare
    /// stays in the first.
    fn grow_crate(&mut self, crate_root: ModuleId, package: PackageId, declared_modules: &[&'a [String]]) {
        if self.modules[crate_root.0].package.is_some() {
            return;
        }
        self.modules[crate_root.0].package = Some(package);
        let mut to_grow = vec![crate_root];
        while let Some(module) = to_grow.pop() {
            let file = self.modules[module.0].file;
            let owns_its_folder = module == crate_root || file.0.file_name().is_some_and(|name| name == "mod.rs");
            let folder = if owns_its_folder { file.folder().to_path_buf() } else { file.0.with_extension("") };
            for name in declared_modules[module.0] {
                let beside = [folder.join(format!("{name}.rs")), folder.join(name).join("mod.rs")].map(RepoPath);
                let Some(child) = beside.iter().find_map(|child_file| self.module_of.get(child_file).copied()) else { continue };
                self.modules[module.0].children.insert(name, child);
                if self.modules[child.0].package.is_none() {
                    (self.modules[child.0].package, self.modules[child.0].crate_root, self.modules[child.0].parent) = (Some(package), crate_root, Some(module));
                    to_grow.push(child);
                }
            }
        }
    }

    /// The type the code in `by` means by `path`, e.g. "MapBox" or "types::MapBox": a `Found::Type`, or a
    /// `Found::PassedOn`.
    pub fn type_meant(&self, by: &'a MapBox, path: &str) -> Option<Found<'a>> {
        self.meant(by, path, Want::Type).filter(|found| matches!(found, Found::Type(_) | Found::PassedOn(_)))
    }

    /// What the code in `by` calls as `path`: a function or method, or a type it builds or whose method isn't on the map.
    pub fn called(&self, by: &'a MapBox, path: &str) -> Option<Found<'a>> {
        self.meant(by, path, Want::Callable)
    }

    /// The id of the box, member or file that `import`, in the file of `into`, brings in.
    pub fn imported(&self, into: &MapBox, import: &Import) -> Option<&'a str> {
        let module = *self.module_of.get(&into.file)?;
        let want = if import.name == EVERY_NAME { Want::Holder } else { Want::Anything };
        self.import(module, import, want, 0).map(|found| self.id(found))
    }

    /// The id an arrow to `found` ends at: the type's box, the function, or the module's file.
    pub fn id(&self, found: Found<'a>) -> &'a str {
        match found {
            Found::Module(module) | Found::PassedOn(module) => self.modules[module.0].file.as_str(),
            Found::Type(type_box) => type_box.id.as_str(),
            Found::Function(function) => function.member.id.as_str(),
        }
    }

    /// Whether code in module `from` can name what is in module `holding` directly: they are in the same Cargo
    /// package, or `from`'s package lists `holding`'s as a dependency. Always, outside Cargo's packages.
    fn may_name(&self, from: ModuleId, holding: ModuleId) -> bool {
        let (Some(from_package), Some(holding_package)) = (self.modules[from.0].package, self.modules[holding.0].package) else { return true };
        from_package == holding_package || self.workspace.packages[from_package.0].depends_on.values().any(|on| *on == holding_package)
    }

    /// The module whose file holds what was `found`.
    fn module_holding(&self, found: Found<'a>) -> Option<ModuleId> {
        match found {
            Found::Module(module) | Found::PassedOn(module) => Some(module),
            Found::Type(type_box) => self.module_of.get(&type_box.file).copied(),
            Found::Function(function) => Some(function.module),
        }
    }

    /// What the code in box `by` means by `path`. `Self` is the type `by` is, or is an `impl` of.
    fn meant(&self, by: &'a MapBox, path: &str, want: Want) -> Option<Found<'a>> {
        let module = *self.module_of.get(&by.file)?;
        let names: Vec<&str> = path.split("::").collect();
        match names.split_first()? {
            (&"Self", rest) => self.walk(module, Found::Type(self.own_type(by)?), rest, want, 0),
            _ => self.path(module, &names, want, 0),
        }
    }

    /// The type a box is: itself, or for a Rust `impl` in another file than its type's, that type if the type's
    /// name is in scope there. An `impl` of a type that isn't (one from outside the repository, or written with
    /// its path) stands in for the type itself. None for a file.
    fn own_type(&self, of: &'a MapBox) -> Option<&'a MapBox> {
        let module = *self.module_of.get(&of.file)?;
        match of.kind() {
            BoxKind::File => None,
            BoxKind::Impl => match self.in_scope(module, &of.name, Want::Type, 0) {
                Some(Found::Type(type_box)) => Some(type_box),
                _ => Some(of),
            },
            _ => Some(of),
        }
    }

    /// What path `names` means in `module`, starting from `crate`, `self`, `super`, or a name in scope there.
    fn path(&self, module: ModuleId, names: &[&str], want: Want, hops: usize) -> Option<Found<'a>> {
        let (first, rest) = names.split_first()?;
        let here = &self.modules[module.0];
        let start = match *first {
            "crate" => Found::Module(here.crate_root),
            "self" => Found::Module(module),
            "super" => Found::Module(here.parent?),
            name => self.in_scope(module, name, if rest.is_empty() { want } else { Want::Holder }, hops)?,
        };
        self.walk(module, start, rest, want, hops)
    }

    /// What the `rest` of a path, written in module `from`, means after its `start`. When that is in a package
    /// `from`'s package doesn't depend on, it was re-exported along the way: the answer is then the last module on
    /// the path that `from` may name, as `Found::PassedOn`.
    fn walk(&self, from: ModuleId, start: Found<'a>, rest: &[&str], want: Want, hops: usize) -> Option<Found<'a>> {
        let mut modules_passed = vec![];
        let found = self.follow(start, rest, want, hops, &mut modules_passed)?;
        if self.module_holding(found).is_none_or(|holding| self.may_name(from, holding)) {
            return Some(found);
        }
        modules_passed.into_iter().rev().find(|passed| self.may_name(from, *passed)).map(Found::PassedOn)
    }

    /// Follows the `rest` of a path from what its `start` means, noting each module on the way in `modules_passed`.
    /// A name after a type is one of its methods, if the map has it and a function is wanted; else (a variant, a
    /// constant, a derived method) the type itself is meant.
    fn follow(&self, start: Found<'a>, rest: &[&str], want: Want, hops: usize, modules_passed: &mut Vec<ModuleId>) -> Option<Found<'a>> {
        let mut at = start;
        for (index, name) in rest.iter().enumerate() {
            let is_last = index + 1 == rest.len();
            at = match at {
                Found::Module(module) => {
                    modules_passed.push(module);
                    if *name == "super" { Found::Module(self.modules[module.0].parent?) } else { self.member(module, name, if is_last { want } else { Want::Holder }, hops)? }
                }
                Found::Type(holder) => {
                    let method = self.methods.get(holder.id.as_str()).and_then(|methods| methods.get(name)).filter(|_| is_last && want == Want::Callable);
                    return Some(method.map_or(at, |method| Found::Function(*method)));
                }
                // Whatever is inside something passed on is passed on with it.
                Found::PassedOn(_) => return Some(at),
                Found::Function(_) => return None,
            };
        }
        Some(at).filter(|found| fits(found, want))
    }

    /// What `name` means where code in `module` can use it bare: one of the module's own names (see `member`), else
    /// a crate the module's package depends on, or the package's own library.
    fn in_scope(&self, module: ModuleId, name: &str, want: Want, hops: usize) -> Option<Found<'a>> {
        self.member(module, name, want, hops).or_else(|| self.library(module, name).filter(|library| fits(library, want)))
    }

    /// The root module of the library that code in `module` calls `name`: a dependency of its package, or the
    /// package's own library (as its programs and tests name it).
    fn library(&self, module: ModuleId, name: &str) -> Option<Found<'a>> {
        let package = self.modules[module.0].package?;
        let own = &self.workspace.packages[package.0];
        let named = if own.library_name == name { package } else { *own.depends_on.get(name)? };
        let root = self.workspace.packages[named.0].library.as_ref()?;
        self.module_of.get(root).map(|root| Found::Module(*root))
    }

    /// What `name` means inside `module`: something it declares (a type, function or module), something it imports
    /// by that name, or something one of its glob imports brings in.
    fn member(&self, module: ModuleId, name: &str, want: Want, hops: usize) -> Option<Found<'a>> {
        let lookup = (module, name.to_string(), want);
        if let Some(known) = self.looked_up.borrow().get(&lookup) {
            return *known;
        }
        self.looked_up.borrow_mut().insert(lookup.clone(), None);
        let found = self.member_uncached(module, name, want, hops);
        self.looked_up.borrow_mut().insert(lookup, found);
        found
    }

    /// `member`, worked out afresh.
    fn member_uncached(&self, module: ModuleId, name: &str, want: Want, hops: usize) -> Option<Found<'a>> {
        let here = &self.modules[module.0];
        let own_type = here.types.get(name).map(|type_box| Found::Type(type_box));
        let own_function = here.functions.get(name).map(|function| Found::Function(*function));
        let own_module = here.children.get(name).map(|child| Found::Module(*child));
        let declared = match want {
            Want::Holder => own_module.or(own_type),
            Want::Type => own_type,
            Want::Callable => own_function.or(own_type),
            Want::Anything => own_type.or(own_function).or(own_module),
        };
        if declared.is_some() || hops >= MOST_HOPS {
            return declared;
        }
        let by_name = here.imports.iter().filter(|import| import.name == name).find_map(|import| self.import(module, import, want, hops + 1));
        by_name.or_else(|| here.imports.iter().filter(|import| import.name == EVERY_NAME).find_map(|glob| {
            match self.import(module, glob, Want::Holder, hops + 1)? {
                Found::Module(globbed) if globbed != module => self.walk(module, Found::Module(globbed), &[name], want, hops + 1),
                // `use Kind::*` brings in the enum's variants: each means the enum.
                Found::Type(globbed) if want != Want::Type => globbed.members().iter().any(|variant| variant.kind == MemberKind::Variant && variant.name == name).then_some(Found::Type(globbed)),
                _ => None,
            }
        }))
    }

    /// What `import`, written in `module`, brings in.
    fn import(&self, module: ModuleId, import: &Import, want: Want, hops: usize) -> Option<Found<'a>> {
        // TypeScript: the first of the import's files that is parsed, then the name inside it.
        if !import.files.is_empty() {
            let file = *import.files.iter().find_map(|file| self.module_of.get(file))?;
            return match import.path.first().map(String::as_str) {
                None => Some(Found::Module(file)).filter(|found| fits(found, want)),
                // A default export has no name of its own; by convention it is named as it is imported.
                Some("default") => self.member(file, &import.name, want, hops),
                Some(original) => self.member(file, original, want, hops),
            };
        }
        let names: Vec<&str> = import.path.iter().map(String::as_str).collect();
        // In `use run::run`, the first `run` is a module declared here or a crate, never the name being imported.
        match names.split_first()? {
            (first, rest) if *first == import.name && !rest.is_empty() => {
                let declared_here = self.modules[module.0].children.get(first).map(|child| Found::Module(*child));
                self.walk(module, declared_here.or_else(|| self.library(module, first))?, rest, want, hops)
            }
            _ => self.path(module, &names, want, hops),
        }
    }
}

/// Whether what was `found` is the kind of thing wanted.
fn fits(found: &Found, want: Want) -> bool {
    let holds_names = matches!(found, Found::Module(_) | Found::Type(_));
    match want {
        Want::Anything => true,
        Want::Holder => holds_names || matches!(found, Found::PassedOn(_)),
        Want::Type => matches!(found, Found::Type(_) | Found::PassedOn(_)),
        Want::Callable => !matches!(found, Found::Module(_)),
    }
}

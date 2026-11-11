//! Dependencies between boxes: turns the names each box mentions (types, calls, imports, generated copies, Markdown
//! links) into arrows to the boxes they mean, and fills in which traits each box implements. `resolve` says what a
//! name in code means; a name it can't trace gets no arrow, never a guessed one.
use crate::review::cargo::{Manifest, Workspace};
use crate::review::compare::Parsed;
use crate::review::parse::Mention;
use crate::review::resolve::{Found, Resolver};
use crate::types::{BoxContent, BoxKind, MapId, MapBox, Dependency, DependencyKind, MemberKind, RepoPath, TraitRef};
use std::collections::{BTreeMap, HashMap, HashSet};

/// The dependencies found so far, and the file each arrow can start or end in, by box or member id.
struct Arrows<'a> {
    found: Vec<Dependency>,
    file_of: HashMap<&'a str, &'a RepoPath>,
}

impl Arrows<'_> {
    /// Adds an arrow from `from` to `to`, mentioned on `line`.
    fn add(&mut self, from: &str, to: &str, kind: DependencyKind, line: Option<u32>) {
        self.found.push(Dependency { from: MapId(from.into()), to: MapId(to.into()), kind, label: None, line });
    }

    /// Adds an arrow from `from` to what `mention` was `found` to mean. One that ends at a re-exporting module's
    /// file (`Found::PassedOn`) is labelled with the name used, e.g. "Level::new", since the file alone doesn't say.
    fn add_found<'boxes>(&mut self, resolver: &Resolver<'boxes>, from: &str, found: Found<'boxes>, kind: DependencyKind, mention: &Mention) {
        self.add(from, resolver.id(found), kind, Some(mention.line));
        if let (Found::PassedOn(_), Some(arrow)) = (found, self.found.last_mut()) {
            arrow.label = Some(mention.path.clone());
        }
    }

    /// Adds an arrow to each type the code in `by` means by one of `mentions`, except to `by` itself.
    fn add_types<'boxes>(&mut self, resolver: &Resolver<'boxes>, by: &'boxes MapBox, from: &str, mentions: &[Mention], kind: DependencyKind) {
        for mention in mentions {
            if let Some(to) = resolver.type_meant(by, &mention.path).filter(|to| resolver.id(*to) != by.id.as_str()) {
                self.add_found(resolver, from, to, kind, mention);
            }
        }
    }

    /// The file an arrow's end is in.
    fn file(&self, end: &MapId) -> Option<&RepoPath> {
        self.file_of.get(end.as_str()).copied()
    }

    /// Drops each "imports" arrow that another arrow from the same file already explains: one to the imported thing
    /// or to something inside it, such as a call of an imported type's method.
    fn drop_explained_imports(&mut self) {
        let mut explained: HashSet<(&RepoPath, &str)> = HashSet::new();
        for used in self.found.iter().filter(|used| used.kind != DependencyKind::Imports) {
            let Some(from_file) = self.file_of.get(used.from.as_str()) else { continue };
            // The thing used, then each box it is in, out to its file.
            let mut holder = Some(used.to.as_str());
            while let Some(id) = holder {
                explained.insert((from_file, id));
                holder = id.rsplit_once("::").map(|(outer, _)| outer);
            }
        }
        let is_explained: Vec<bool> = self.found.iter().map(|import| {
            import.kind == DependencyKind::Imports && self.file_of.get(import.from.as_str()).is_some_and(|file| explained.contains(&(*file, import.to.as_str())))
        }).collect();
        let mut is_explained = is_explained.into_iter();
        self.found.retain(|_| !is_explained.next().unwrap_or(false));
    }

    /// Drops each arrow from one Cargo package's Rust code to another's that Cargo does not allow, because the first
    /// does not depend on the second, even through others. Resolving by Cargo's rules can't make one: a debug build
    /// stops here if it did.
    fn drop_what_cargo_forbids(&mut self, workspace: &Workspace) {
        let allowed: Vec<bool> = self.found.iter().map(|arrow| {
            let (Some(from), Some(to)) = (self.file(&arrow.from), self.file(&arrow.to)) else { return true };
            let (Some(from_package), Some(to_package)) = (workspace.package_of(from), workspace.package_of(to)) else { return true };
            let is_code = from.is_rust() && to.is_rust();
            let allowed = !is_code || workspace.allows(from_package, to_package);
            debug_assert!(allowed, "{} -> {} crosses packages against Cargo.toml", arrow.from, arrow.to);
            allowed
        }).collect();
        let mut allowed = allowed.into_iter();
        self.found.retain(|_| allowed.next().unwrap_or(true));
    }
}

/// Resolves names into dependencies and each box's `implements`, and sorts the boxes by place. Every box is kept,
/// changed or not, so the map shows the whole project. Removed things are never targets. `cur` are the files that
/// exist now, and `manifests` the `Cargo.toml` files among them.
pub fn find_dependencies(all: Vec<Parsed>, cur: &HashSet<RepoPath>, manifests: &[Manifest]) -> (Vec<MapBox>, Vec<Dependency>) {
    let workspace = Workspace::read(manifests, cur);
    let resolver = Resolver::new(&all, &workspace);
    let file_of = all.iter().flat_map(|parsed| {
        let map_box = &parsed.map_box;
        map_box.members().iter().map(|member| member.id.as_str()).chain([map_box.id.as_str()]).map(|id| (id, &map_box.file))
    }).collect();
    let mut arrows = Arrows { found: vec![], file_of };
    let mut implements = vec![];
    for parsed in &all {
        let by = &parsed.map_box;
        for import in &parsed.imports {
            // An import of a file visvet doesn't parse, e.g. a stylesheet, still points at the file.
            let unparsed_file = || import.files.iter().find(|file| cur.contains(*file)).map(RepoPath::as_str);
            let imported = resolver.imported(by, import).or_else(unparsed_file);
            if let Some(to) = imported.filter(|to| arrows.file_of.get(to).is_none_or(|file| **file != by.file)) {
                arrows.add(by.id.as_str(), to, DependencyKind::Imports, Some(import.line));
            }
        }
        arrows.add_types(&resolver, by, by.id.as_str(), &parsed.types, DependencyKind::Has);
        arrows.add_types(&resolver, by, by.id.as_str(), &parsed.traits, DependencyKind::Implements);
        for member in &parsed.members {
            let from = member.member.as_str();
            // A field "has" the types it holds; a function "uses" the types its body really uses.
            let holds = matches!(member.kind, MemberKind::Field | MemberKind::Variant);
            arrows.add_types(&resolver, by, from, &member.types, if holds { DependencyKind::Has } else { DependencyKind::Uses });
            for built in &member.creates {
                // An `impl` standing in for its own type (see `Resolver::own_type`) doesn't point at itself.
                let stands_in = by.kind() == BoxKind::Impl;
                if let Some(to) = resolver.type_meant(by, &built.path).filter(|to| !stands_in || resolver.id(*to) != by.id.as_str()) {
                    arrows.add_found(&resolver, from, to, DependencyKind::Creates, built);
                }
            }
            for call in &member.calls {
                let Some(to) = resolver.called(by, &call.path).filter(|to| resolver.id(*to) != from) else { continue };
                let kind = match to {
                    // Calling a type by its own name builds it, like `Wrapper(x)`; any other path into it, like
                    // `Kind::Variant(x)` or a derived `Config::default()`, uses it.
                    Found::Type(built) if call.path.ends_with(&built.name) => DependencyKind::Creates,
                    Found::Type(_) => DependencyKind::Uses,
                    _ => DependencyKind::Calls,
                };
                if resolver.id(to) != by.id.as_str() || kind == DependencyKind::Creates {
                    arrows.add_found(&resolver, from, to, kind, call);
                }
            }
        }
        // One arrow per linked box, labelled by the first title any link to it has.
        let mut linked: BTreeMap<&str, Option<String>> = BTreeMap::new();
        for link in parsed.links.iter().filter(|link| arrows.file_of.contains_key(link.target.as_str()) && link.target != by.id.as_str()) {
            let label = linked.entry(link.target.as_str()).or_default();
            if label.is_none() {
                label.clone_from(&link.label);
            }
        }
        for (to, label) in linked {
            arrows.add(by.id.as_str(), to, DependencyKind::Links, None);
            arrows.found.last_mut().expect("just added").label = label;
        }
        let generated: Vec<&String> = parsed.generates.iter().filter(|to| arrows.file_of.contains_key(to.as_str())).collect();
        for to in generated {
            arrows.add(by.id.as_str(), to, DependencyKind::Generates, None);
        }
        let trait_ref = |named: &Mention| TraitRef {
            name: named.path.rsplit("::").next().unwrap_or_default().to_string(),
            box_id: match resolver.type_meant(by, &named.path) {
                Some(Found::Type(implemented)) => Some(implemented.id.clone()),
                _ => None,
            },
        };
        implements.push(parsed.traits.iter().map(trait_ref).collect());
    }
    for package in &workspace.packages {
        for on in package.depends_on.values() {
            arrows.add(package.manifest.as_str(), workspace.packages[on.0].manifest.as_str(), DependencyKind::Depends, None);
        }
    }
    arrows.drop_explained_imports();
    arrows.drop_what_cargo_forbids(&workspace);
    // One arrow per pair and kind: the first mention's.
    let mut seen = HashSet::new();
    arrows.found.retain(|arrow| seen.insert((arrow.from.clone(), arrow.to.clone(), arrow.kind)));
    let dependencies = arrows.found;
    let mut boxes: Vec<MapBox> = all.into_iter().zip(implements).map(|(mut p, traits)| {
        if let BoxContent::Code { implements, .. } = &mut p.map_box.content {
            *implements = traits;
        }
        p.map_box
    }).collect();
    boxes.sort_by(|a, b| (&a.file, a.lines.first).cmp(&(&b.file, b.lines.first)));
    (boxes, dependencies)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::review::compare::tests::cmp;

    /// The boxes and dependencies of a repository holding `files`, each a path and its text; those named
    /// `Cargo.toml` are its manifests.
    fn review_of(files: &[(&str, &str)]) -> (Vec<MapBox>, Vec<Dependency>) {
        let cur: HashSet<RepoPath> = files.iter().map(|(file, _)| RepoPath(file.into())).collect();
        let is_manifest = |file: &str| file.ends_with("Cargo.toml");
        let manifests: Vec<Manifest> = files.iter().filter(|(file, _)| is_manifest(file)).map(|(file, text)| Manifest { file: RepoPath(file.into()), text: text.to_string() }).collect();
        let all = files.iter().flat_map(|(file, text)| cmp(file, Some(text.as_bytes()), None)).collect();
        find_dependencies(all, &cur, &manifests)
    }

    /// The dependencies among `files` as "from -> to kind", in the order found.
    fn arrows_of(files: &[(&str, &str)]) -> Vec<String> {
        review_of(files).1.iter().map(|arrow| format!("{} -> {} {}", arrow.from, arrow.to, arrow.kind.label())).collect()
    }

    /// A workspace of three packages: `app` depends on `ports`; `lone` depends on nothing. `ports` has a trait
    /// named `Display` and functions named `from` and `chosen`, names that `app` also uses for other things.
    const WORKSPACE: [(&str, &str); 9] = [
        ("Cargo.toml", "[workspace]\nmembers = [\"crates/*\"]\n[workspace.dependencies]\nports = { path = \"crates/ports\" }"),
        ("crates/ports/Cargo.toml", "[package]\nname = \"ports\""),
        ("crates/ports/src/lib.rs", "pub mod screen;\npub use screen::Display;\npub fn from(raw: u8) -> u8 { raw }\npub fn chosen() {}"),
        ("crates/ports/src/screen.rs", "pub trait Display { fn show(&self); }\npub struct Pixel;"),
        ("crates/app/Cargo.toml", "[package]\nname = \"app\"\n[dependencies]\nports.workspace = true"),
        ("crates/app/src/lib.rs", "mod model;\nmod view;"),
        ("crates/app/src/model.rs", "use std::fmt;\npub struct Score { pub points: u64 }\nimpl fmt::Display for Score { fn fmt(&self) {} }\nimpl Score {\n    pub fn widen(raw: u32) -> u64 { u64::from(raw) }\n    pub fn pick(&self) -> u8 { let chosen = |x: u8| x; chosen(1) }\n}"),
        ("crates/app/src/view.rs", "use ports::{Display, screen::Pixel};\nuse super::model::Score;\nuse crate::model as scores;\npub struct Panel { pixel: Pixel, score: Score }\nimpl Display for Panel {\n    fn show(&self) { ports::chosen(); let total = scores::Score::widen(1); Self::draw(total); self.draw(2); helper::<Pixel>(); total.pick(); }\n}\nimpl Panel { fn draw(n: u64) {} }\nfn helper<T>() { T::default(); from(1); }"),
        ("crates/lone/Cargo.toml", "[package]\nname = \"lone\""),
    ];

    #[test]
    fn a_rust_name_means_what_its_imports_and_cargo_say() {
        assert_eq!(arrows_of(&WORKSPACE), [
            // A re-export: the root passes `Display` on from its `screen` module.
            "crates/ports/src/lib.rs -> crates/ports/src/screen.rs::Display imports",
            // `Display` here is the one imported from `ports`, so the impl links to it; `fmt::Display` in model.rs links to nothing.
            "crates/app/src/view.rs::Panel -> crates/ports/src/screen.rs::Display implements",
            "crates/app/src/view.rs::Panel::pixel -> crates/ports/src/screen.rs::Pixel has",
            "crates/app/src/view.rs::Panel::score -> crates/app/src/model.rs::Score has",
            "crates/app/src/view.rs::Panel::show -> crates/ports/src/screen.rs::Pixel uses",
            // Calls by path, through an alias, and on `Self` and `self`; `total.pick()` is on a value, so not guessed.
            "crates/app/src/view.rs::Panel::show -> crates/ports/src/lib.rs::chosen calls",
            "crates/app/src/view.rs::Panel::show -> crates/app/src/model.rs::Score::widen calls",
            "crates/app/src/view.rs::Panel::show -> crates/app/src/view.rs::Panel::draw calls",
            "crates/app/src/view.rs::Panel::show -> crates/app/src/view.rs::helper calls",
            "crates/app/Cargo.toml -> crates/ports/Cargo.toml depends",
        ]);
    }

    #[test]
    fn nothing_crosses_to_a_crate_cargo_does_not_allow() {
        // `lone` names things in crates it doesn't depend on, by their paths and bare: none of it means anything there.
        let lone = ("crates/lone/src/lib.rs", "use ports::chosen;\npub struct Score;\npub fn show() { ports::chosen(); chosen(); from(1); let panel = app::view::Panel { score: Score {} }; }");
        let files = [&WORKSPACE[..], &[lone]].concat();
        let from_lone: Vec<String> = arrows_of(&files).into_iter().filter(|arrow| arrow.starts_with("crates/lone")).collect();
        assert_eq!(from_lone, ["crates/lone/src/lib.rs::show -> crates/lone/src/lib.rs::Score creates"]);
        // And `ports`, which `app` depends on, can't name `app` back.
        let back = ("crates/ports/src/back.rs", "fn back() { app::model::Score::widen(1); }");
        let mut files = [&WORKSPACE[..], &[back]].concat();
        files[2].1 = "mod back;\npub mod screen;";
        assert!(!arrows_of(&files).iter().any(|arrow| arrow.starts_with("crates/ports/src/back.rs")));
    }

    #[test]
    fn a_re_export_from_a_crate_not_depended_on_ends_at_the_crate_that_passes_it_on() {
        let files = [
            ("kernel/Cargo.toml", "[package]\nname = \"kernel\""),
            ("kernel/src/lib.rs", "pub struct Level;\nimpl Level { pub fn new() -> Self { Level } }"),
            ("facade/Cargo.toml", "[package]\nname = \"facade\"\n[dependencies]\nkernel = { path = \"../kernel\" }"),
            ("facade/src/lib.rs", "pub use kernel::Level;"),
            ("user/Cargo.toml", "[package]\nname = \"user\"\n[dependencies]\nfacade = { path = \"../facade\" }"),
            ("user/src/main.rs", "use facade::Level;\nfn load() { Level::new(); }\nfn hold(level: facade::Level) -> u8 { match level { Level => 0 } }"),
        ];
        let (_, dependencies) = review_of(&files);
        let arrows: Vec<_> = dependencies.iter().map(|arrow| (arrow.from.as_str(), arrow.to.as_str(), arrow.kind.label(), arrow.label.as_deref(), arrow.line)).collect();
        assert_eq!(arrows, [
            ("facade/src/lib.rs", "kernel/src/lib.rs::Level", "imports", None, Some(1)),
            // `user` knows only `facade`: its call ends there, labelled with the name it used, on the line it used it.
            ("user/src/main.rs::load", "facade/src/lib.rs", "calls", Some("Level::new"), Some(2)),
            ("facade/Cargo.toml", "kernel/Cargo.toml", "depends", None, None),
            ("user/Cargo.toml", "facade/Cargo.toml", "depends", None, None),
        ]);
    }

    #[test]
    fn a_typescript_name_means_what_the_file_imports() {
        let files = [
            ("ui/a.tsx", "import { load as fetchAll, Shape, deep } from './b';\nimport View from './View';\nimport * as model from './model';\nimport './style.css';\nimport r from 'react';\nfunction A() { fetchAll(); stray(); deep(); return <View kind={Shape.Round} /> }\nclass C { go() { this.stop(); A(); } stop() { new C(); } }"),
            ("ui/b.ts", "export function load() {}\nexport enum Shape { Round }\nexport * from './c';"),
            ("ui/c.ts", "export function deep() {}\nexport function stray() {}"),
            ("ui/View.tsx", "export default function View() { const deep = () => 1; deep(); return <div /> }\nfunction deep() {}"),
            ("ui/model.ts", "export function stray() {}"),
            ("ui/style.css", ""),
        ];
        assert_eq!(arrows_of(&files), [
            // Imports nothing else explains: the namespace nobody calls into, and the stylesheet.
            "ui/a.tsx -> ui/model.ts imports",
            "ui/a.tsx -> ui/style.css imports",
            "ui/a.tsx::A -> ui/b.ts::Shape uses",
            // `stray` is imported from nowhere, so it means neither file's `stray`; `deep` comes through `export *`.
            "ui/a.tsx::A -> ui/b.ts::load calls",
            "ui/a.tsx::A -> ui/c.ts::deep calls",
            "ui/a.tsx::A -> ui/View.tsx::View calls",
            "ui/a.tsx::C::go -> ui/a.tsx::C::stop calls",
            "ui/a.tsx::C::go -> ui/a.tsx::A calls",
            "ui/a.tsx::C::stop -> ui/a.tsx::C creates",
            "ui/b.ts -> ui/c.ts imports",
        ]);
    }

    #[test]
    fn every_box_is_kept_and_only_live_ones_are_linked() {
        let mut all = cmp("a.rs", Some(b"struct A { b: B, c: C }\nstruct B;\nimpl T for A {}"), Some(b"struct A { b: B }\nstruct B;\nstruct C;\ntrait T {}"));
        all.extend(cmp("c.rs", Some(b"struct C;\nstruct Lone;"), Some(b"struct C;\nstruct Lone;")));
        let (boxes, dependencies) = find_dependencies(all, &HashSet::new(), &[]);
        // Every box is kept, changed or not, so the map always shows the whole project.
        let ids: Vec<_> = boxes.iter().map(|map_box| map_box.id.as_str()).collect();
        assert_eq!(ids, ["a.rs", "a.rs::A", "a.rs::B", "a.rs::C", "a.rs::T", "c.rs", "c.rs::C", "c.rs::Lone"]);
        // `C` and `T` were removed from a.rs, and the `C` in c.rs is not in scope there: only `B` is linked.
        let arrows: Vec<_> = dependencies.iter().map(|arrow| (arrow.from.as_str(), arrow.to.as_str(), arrow.kind.label())).collect();
        assert_eq!(arrows, [("a.rs::A::b", "a.rs::B", "has")]);
    }

    #[test]
    fn uses_type_edges() {
        let src = b"struct V;\nenum K { A }\nfn set(v: Json<V>) -> K {}\nfn put(Json(v): Json<K>) {}\nfn get() { load::<V>() }\nfn pick(k: K) { match k { K::A => V::new() } }";
        let (_, edges) = find_dependencies(cmp("a.rs", Some(src), None), &HashSet::new(), &[]);
        let e: Vec<_> = edges.iter().filter(|e| e.kind == DependencyKind::Uses).map(|e| (e.from.as_str(), e.to.as_str())).collect();
        assert_eq!(e, [("a.rs::put", "a.rs::K"), ("a.rs::get", "a.rs::V"), ("a.rs::pick", "a.rs::K"), ("a.rs::pick", "a.rs::V")]);
    }
}

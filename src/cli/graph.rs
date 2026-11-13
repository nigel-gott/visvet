//! `visvet graph`: the review map as text, so the AI sees the coupling, cycles and complexity the user sees. Like the
//! map, it reports each level by that level's own arrows: between packages, between the files of one package,
//! between the types and functions of one file, and for each box, the arrows between the boxes directly inside it.
use crate::{review::build_review, types::{DependencyKind, DiffLineKind, Dependency, Member, MapBox, ChangeStatus, MemberKind, BoxKind, RepoPath}};
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::path::{Path, PathBuf};

/// A count per name, e.g. links per kind.
type Counts<'a> = BTreeMap<&'a str, usize>;
/// Each box's distinct neighbours: the boxes it links to.
type Graph<'a> = BTreeMap<&'a str, BTreeSet<&'a str>>;

/// How many links leave a box and how many arrive at it.
#[derive(Default, Clone, Copy)]
struct LinkCount { outgoing: usize, incoming: usize }

/// The whole map's name as a zoom view, among views named by their box.
const WHOLE_MAP: &str = "(whole map)";
/// The files whose folder is a package: its files are one level of the map's structure.
const PACKAGE_MANIFESTS: [&str; 2] = ["Cargo.toml", "package.json"];
/// When a box is "common" in a zoom view, as the map decides it (`COMMON` in ui/src/view.ts): at least this many
/// of its siblings point at it, and at least this share of them all. The map hides arrows to it by default.
const COMMON_LEAST: usize = 5;
const COMMON_SHARE: f64 = 0.5;
/// The most rows a section prints.
const ROWS: usize = 10;

/// Where a box, member or file sits on the map.
struct Place {
    /// The boxes it sits in, outermost first, ending with itself: folders, its file (inside the Rust file `x.rs`
    /// when it is in folder `x/`, as on the map), its type or free fn, the member.
    nesting: Vec<String>,
    /// How many of `nesting` are folders and files: the rest are boxes inside the file.
    file_depth: usize,
    /// The folder of the package it is in (the innermost one holding a `PACKAGE_MANIFESTS` file), "." for the root's.
    package: String,
    file: String,
    /// Its first folder, or "." for a file at the root.
    top_folder: String,
}

impl Place {
    /// The type or free function it is, or is in; none for a file itself.
    fn item(&self) -> Option<&str> {
        self.nesting.get(self.file_depth).map(String::as_str)
    }
}

/// Every live box's and member's place, by id.
type Places<'a> = HashMap<&'a str, Place>;

/// What one box looks like zoomed in: the arrows between the boxes directly inside it, each with how many links it
/// stands for, and the boxes outside it that its insides link to or from.
#[derive(Default)]
struct ZoomView<'a> {
    arrows: BTreeMap<(&'a str, &'a str), usize>,
    outside_peers: BTreeSet<&'a str>,
}

/// Link tallies: per kind, per top-folder and package pair, per file across top folders, the code links between
/// boxes at each level, the call graph both ways, and each box's zoom view.
#[derive(Default)]
struct Tally<'a> {
    links_per_kind: Counts<'a>,
    /// Links from one top folder to another, per kind.
    top_folder_links: BTreeMap<(&'a str, &'a str), Counts<'a>>,
    /// Links from one package to another, per kind.
    package_links: BTreeMap<(&'a str, &'a str), Counts<'a>>,
    /// Per file, its links that leave or enter its top folder.
    cross_folder_links: BTreeMap<&'a str, LinkCount>,
    /// Which package has a code link to which.
    between_packages: Graph<'a>,
    /// Per package, which of its files has a code link to which other.
    between_files: BTreeMap<&'a str, Graph<'a>>,
    /// Per file, which of its types and free functions has a code link to which other.
    between_items: BTreeMap<&'a str, Graph<'a>>,
    /// Per function, the functions it calls.
    callees: Graph<'a>,
    /// Per function, the functions that call it.
    callers: Graph<'a>,
    zoom_views: BTreeMap<&'a str, ZoomView<'a>>,
}

/// Prints the map of the change against `base`, each section worst first: totals, coupling between top folders and
/// between packages, cycles at each level, files linked across top folders, zoom views, then the most complex and
/// most connected functions and files. Removed code is left out.
pub fn print(repo_root: &Path, base: &str) -> anyhow::Result<()> {
    let review = build_review(repo_root, base)?;
    let live: Vec<&MapBox> = review.boxes.iter().filter(|map_box| map_box.status != ChangeStatus::Removed).collect();
    let places = places(&live);
    let holds_code = boxes_holding_code(&live, &places);
    let link_kinds = ["calls", "creates", "has", "implements", "imports", "uses"];
    let mut tally = Tally { links_per_kind: link_kinds.map(|kind| (kind, 0)).into(), ..Default::default() };
    // Both ends must be live: a Markdown link can still name a box the change removed.
    let is_live = |dep: &&Dependency| places.contains_key(dep.from.as_str()) && places.contains_key(dep.to.as_str());
    for dep in review.dependencies.iter().filter(is_live) {
        tally.add(dep, &places[dep.from.as_str()], &places[dep.to.as_str()], &holds_code);
    }
    report(&live, &places, &tally);
    Ok(())
}

/// Where every live box and member sits.
fn places<'a>(boxes: &[&'a MapBox]) -> Places<'a> {
    let files: HashSet<&RepoPath> = boxes.iter().map(|map_box| &map_box.file).collect();
    let package_folders: HashSet<&Path> = files.iter().filter(|file| PACKAGE_MANIFESTS.iter().any(|manifest| file.0.ends_with(manifest))).map(|file| file.folder()).collect();
    let mut places = HashMap::new();
    for map_box in boxes {
        let file_nesting = file_nesting(&map_box.file, &files);
        let package = map_box.file.0.ancestors().skip(1).find(|folder| package_folders.contains(folder)).filter(|folder| *folder != Path::new(""));
        let place = |inside_file: &[&str]| Place {
            nesting: file_nesting.iter().cloned().chain(inside_file.iter().map(|id| id.to_string())).collect(),
            file_depth: file_nesting.len(),
            package: package.map_or(".".to_string(), |folder| folder.display().to_string()),
            file: map_box.file.to_string(),
            top_folder: map_box.file.top_folder().to_string(),
        };
        let own: Vec<&str> = if map_box.kind() == BoxKind::File { vec![] } else { vec![map_box.id.as_str()] };
        for member in map_box.members().iter().filter(|member| member.status != ChangeStatus::Removed) {
            places.insert(member.id.as_str(), place(&[&own[..], &[member.id.as_str()]].concat()));
        }
        places.insert(map_box.id.as_str(), place(&own));
    }
    places
}

/// The boxes `file` sits in on the map, outermost first, ending with the file.
fn file_nesting(file: &RepoPath, files: &HashSet<&RepoPath>) -> Vec<String> {
    let mut nesting = folder_nesting(file.folder(), files);
    nesting.push(file.to_string());
    nesting
}

/// The boxes that stand for `folder` and the folders around it, outermost first: each folder as "path/", except that
/// a folder `x/` beside a Rust file `x.rs` is that file's box, as on the map.
fn folder_nesting(folder: &Path, files: &HashSet<&RepoPath>) -> Vec<String> {
    let Some(around) = folder.parent() else { return vec![] };
    let module_file = RepoPath(PathBuf::from(folder)).with_suffix(".rs");
    if files.contains(&module_file) {
        return file_nesting(&module_file, files);
    }
    let mut nesting = folder_nesting(around, files);
    nesting.push(format!("{}/", folder.display()));
    nesting
}

/// The ids of the boxes that hold code, at any depth: inside them the map leaves Markdown "links" arrows off.
fn boxes_holding_code<'a>(boxes: &[&MapBox], places: &'a Places) -> HashSet<&'a str> {
    let code_boxes = boxes.iter().filter(|map_box| matches!(map_box.content, crate::types::BoxContent::Code { .. }));
    code_boxes.filter_map(|map_box| places.get(map_box.id.as_str())).flat_map(|place| place.nesting.iter().map(String::as_str)).collect()
}

impl<'a> Tally<'a> {
    /// Counts dependency `dep`, whose two ends sit at `from` and `to`.
    fn add(&mut self, dep: &'a Dependency, from: &'a Place, to: &'a Place, holds_code: &HashSet<&str>) {
        *self.links_per_kind.entry(dep.kind.label()).or_default() += 1;
        if dep.kind == DependencyKind::Calls {
            self.callees.entry(dep.from.as_str()).or_default().insert(dep.to.as_str());
            self.callers.entry(dep.to.as_str()).or_default().insert(dep.from.as_str());
        }
        let (from_top, to_top) = (from.top_folder.as_str(), to.top_folder.as_str());
        if from_top != to_top {
            *self.top_folder_links.entry((from_top, to_top)).or_default().entry(dep.kind.label()).or_default() += 1;
            self.cross_folder_links.entry(&from.file).or_default().outgoing += 1;
            self.cross_folder_links.entry(&to.file).or_default().incoming += 1;
        }
        let is_code = dep.kind.counts_for_cycles() || matches!(dep.kind, DependencyKind::Implements | DependencyKind::Depends);
        if from.package != to.package && is_code {
            *self.package_links.entry((&from.package, &to.package)).or_default().entry(dep.kind.label()).or_default() += 1;
        }
        // The coarsest level the two ends differ at is the level the link belongs to.
        if dep.kind.counts_for_cycles() {
            let level = if from.package != to.package {
                Some((&mut self.between_packages, from.package.as_str(), to.package.as_str()))
            } else if from.file != to.file {
                Some((self.between_files.entry(&from.package).or_default(), from.file.as_str(), to.file.as_str()))
            } else {
                from.item().zip(to.item()).filter(|(from_item, to_item)| from_item != to_item)
                    .map(|(from_item, to_item)| (self.between_items.entry(&from.file).or_default(), from_item, to_item))
            };
            if let Some((graph, from_box, to_box)) = level {
                graph.entry(from_box).or_default().insert(to_box);
            }
        }
        self.add_to_zoom_views(dep, from, to, holds_code);
    }

    /// Records a link in the zoom views it shows in: as an arrow between two children of the innermost box holding
    /// both ends, and as an outside peer of each box that holds only one end, where the other end is drawn as its
    /// outermost box not around that one too (as the map draws it: all of another crate as one box). Views of a type's members aren't reported, and "links" only where the map shows them.
    fn add_to_zoom_views(&mut self, dep: &'a Dependency, from: &'a Place, to: &'a Place, holds_code: &HashSet<&str>) {
        let shown_in = |view: &str| dep.kind != DependencyKind::Links || !holds_code.contains(view);
        let shared = from.nesting.iter().zip(&to.nesting).take_while(|(from_box, to_box)| from_box == to_box).count();
        let one_holds_the_other = shared == from.nesting.len() || shared == to.nesting.len();
        if one_holds_the_other {
            return;
        }
        let view = if shared == 0 { WHOLE_MAP } else { from.nesting[shared - 1].as_str() };
        let is_inside_a_type = shared > from.file_depth;
        if !is_inside_a_type && shown_in(view) {
            *self.zoom_views.entry(view).or_default().arrows.entry((&from.nesting[shared], &to.nesting[shared])).or_default() += 1;
        }
        for (inside, outside) in [(from, to), (to, from)] {
            // Each box around this end, down to its file, that the other end is outside of.
            for depth in shared..inside.file_depth.min(inside.nesting.len()) {
                let (zoomed, peer) = (inside.nesting[depth].as_str(), &outside.nesting[shared]);
                if shown_in(zoomed) {
                    self.zoom_views.entry(zoomed).or_default().outside_peers.insert(peer);
                }
            }
        }
    }
}

impl ZoomView<'_> {
    /// The view's common boxes (see `COMMON_LEAST`), when it draws `children` boxes: each child enough others point at.
    fn common_boxes(&self, children: usize) -> BTreeSet<&str> {
        let mut users: BTreeMap<&str, usize> = BTreeMap::new();
        self.arrows.keys().for_each(|(_, to_box)| *users.entry(to_box).or_default() += 1);
        let is_common = |count: usize| count >= COMMON_LEAST && count as f64 >= COMMON_SHARE * (children.saturating_sub(1)) as f64;
        users.into_iter().filter(|(_, count)| is_common(*count)).map(|(common, _)| common).collect()
    }
}

/// Prints the sections from the tallies.
fn report(boxes: &[&MapBox], places: &Places, tally: &Tally) {
    let is_function = |member: &&Member| places.contains_key(member.id.as_str()) && matches!(member.kind, MemberKind::Fn | MemberKind::Method);
    let functions: Vec<&Member> = boxes.iter().flat_map(|map_box| map_box.members()).filter(is_function).collect();
    let files: BTreeSet<&str> = boxes.iter().map(|map_box| map_box.file.as_str()).collect();
    let top_folders = boxes.iter().map(|map_box| map_box.file.top_folder()).collect::<BTreeSet<_>>().len();
    let packages = places.values().map(|place| place.package.as_str()).collect::<BTreeSet<_>>().len();
    let forms = boxes.iter().filter(|map_box| map_box.kind() == BoxKind::Form).count();
    let types = boxes.iter().filter(|map_box| map_box.kind() != BoxKind::File).count() - forms;
    println!("totals: {top_folders} top folders, {packages} packages, {} files, {types} types, {forms} Lisp forms, {} functions; links: {}", files.len(), functions.len(), list(&tally.links_per_kind));
    section("top-folder coupling (from -> to)", usize::MAX, tally.top_folder_links.iter().map(|((from, to), per_kind)| {
        (per_kind.values().sum::<usize>(), format!("{from} -> {to}: {}", list(per_kind)))
    }));
    section("package dependencies (from -> to)", usize::MAX, tally.package_links.iter().map(|((from, to), per_kind)| {
        let uses: usize = per_kind.iter().filter(|(kind, _)| **kind != "depends").map(|(_, count)| count).sum();
        let note = if uses == 0 { " (declared in Cargo.toml, no use found in code)" } else if !per_kind.contains_key("depends") { " (not declared in a Cargo.toml)" } else { "" };
        (uses, format!("{from} -> {to}: {}{note}", list(per_kind)))
    }));
    section("cycles among packages", usize::MAX, cycles(&tally.between_packages).into_iter().map(|cycle| (cycle.len(), cycle.join(", "))));
    for (level_name, level) in [("the files of one package", &tally.between_files), ("the types and functions of one file", &tally.between_items)] {
        let found: Vec<(usize, String)> = level.iter().flat_map(|(inside, graph)| cycles(graph).into_iter().map(move |cycle| {
            (cycle.len(), format!("{inside}: {} in a cycle: {}", cycle.len(), cycle.join(", ")))
        })).collect();
        section(&format!("cycles among {level_name} ({} in all, largest first)", found.len()), ROWS, found.into_iter());
    }
    section("files with the most links across top folders", ROWS, tally.cross_folder_links.iter().map(|(file, links)| {
        (links.outgoing + links.incoming, format!("{file}: {} out, {} in", links.outgoing, links.incoming))
    }));
    // Each box directly inside another, down to a file's types and free functions (a type's members aren't boxes here).
    let mut inside: BTreeSet<(&str, &str)> = BTreeSet::new();
    for place in places.values() {
        let boxes_deep = place.nesting.len().min(place.file_depth + 1);
        inside.extend((0..boxes_deep).map(|depth| (depth.checked_sub(1).map_or(WHOLE_MAP, |parent| place.nesting[parent].as_str()), place.nesting[depth].as_str())));
    }
    let mut children: Counts = Counts::new();
    inside.iter().for_each(|(around, _)| *children.entry(around).or_default() += 1);
    section("zoom views (what each box looks like zoomed in, by its own level's arrows)", ROWS, tally.zoom_views.iter().map(|(zoomed, view)| {
        let boxes_inside = children.get(zoomed).copied().unwrap_or(0);
        let common = view.common_boxes(boxes_inside);
        let hidden = view.arrows.keys().filter(|(_, to_box)| common.contains(to_box)).count();
        let (drawn, peers) = (view.arrows.len() - hidden, view.outside_peers.len());
        let common_note = if hidden > 0 { format!(" (+{hidden} hidden, to {} common boxes)", common.len()) } else { String::new() };
        (drawn + peers, format!("{zoomed}: {boxes_inside} boxes, {drawn} arrows between them{common_note}, {peers} outside peers"))
    }));
    let lines = |function: &Member| function.diff.iter().filter(|line| line.kind != DiffLineKind::Removed).count();
    section("most complex functions (complexity, lines)", ROWS, functions.iter().map(|function| {
        ((function.complexity, lines(function)), format!("{:>3} {:>4}  {}", function.complexity, lines(function), function.id))
    }));
    for (title, graph) in [("most callees (fan-out)", &tally.callees), ("most callers (fan-in)", &tally.callers)] {
        section(title, ROWS, graph.iter().map(|(function, linked)| (linked.len(), format!("{:>3}  {function}", linked.len()))));
    }
    let mut file_users: Counts = Counts::new();
    tally.between_files.values().flat_map(|graph| graph.values().flatten()).for_each(|used| *file_users.entry(used).or_default() += 1);
    section("files most used by other files of their package (fan-in)", ROWS, file_users.iter().map(|(file, users)| (*users, format!("{users:>3}  {file}"))));
}

/// Groups of two or more boxes that all reach each other through links: the strongly connected components.
fn cycles<'a>(graph: &Graph<'a>) -> Vec<Vec<&'a str>> {
    let reachable_from = |start: &'a str| {
        let (mut seen, mut to_visit) = (BTreeSet::new(), vec![start]);
        while let Some(node) = to_visit.pop() {
            to_visit.extend(graph.get(node).into_iter().flatten().copied().filter(|next| seen.insert(*next)));
        }
        seen
    };
    let reach: BTreeMap<_, _> = graph.keys().map(|&node| (node, reachable_from(node))).collect();
    let mut cycles: Vec<Vec<&str>> = vec![];
    for (node, from_node) in &reach {
        let in_a_cycle = from_node.contains(node);
        if in_a_cycle && !cycles.iter().any(|cycle| cycle.contains(node)) {
            let reach_each_other = |(other, from_other): &(&&str, &BTreeSet<&str>)| from_node.contains(*other) && from_other.contains(node);
            cycles.push(reach.iter().filter(reach_each_other).map(|(other, _)| *other).collect());
        }
    }
    cycles
}

/// Counts as "8 calls, 2 has".
fn list(counts: &Counts) -> String {
    counts.iter().map(|(name, count)| format!("{count} {name}")).collect::<Vec<_>>().join(", ")
}

/// Prints `title`, then its first `limit` rows by key, highest first.
fn section<Key: Ord>(title: &str, limit: usize, rows: impl Iterator<Item = (Key, String)>) {
    let mut rows: Vec<_> = rows.collect();
    rows.sort_by(|(key_a, text_a), (key_b, text_b)| key_b.cmp(key_a).then_with(|| text_a.cmp(text_b)));
    println!("{title}:{}", if rows.is_empty() { " none" } else { "" });
    rows.iter().take(limit).for_each(|(_, text)| println!("  {text}"));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_nests_in_its_folders_and_in_the_rust_file_named_like_its_folder() {
        let paths = ["src/review.rs", "src/review/parse.rs", "src/review/parse/rust.rs", "ui/src/view.ts"].map(|path| RepoPath(path.into()));
        let files: HashSet<&RepoPath> = paths.iter().collect();
        assert_eq!(file_nesting(&paths[2], &files), ["src/", "src/review.rs", "src/review/parse.rs", "src/review/parse/rust.rs"]);
        assert_eq!(file_nesting(&paths[3], &files), ["ui/", "ui/src/", "ui/src/view.ts"]);
    }

    #[test]
    fn boxes_that_reach_each_other_are_one_cycle() {
        let graph: Graph = [("a", ["b"]), ("b", ["c"]), ("c", ["a"]), ("d", ["a"])].into_iter().map(|(from, to)| (from, to.into())).collect();
        assert_eq!(cycles(&graph), [["a", "b", "c"]]);
    }
}

//! `visvet graph`: the review map as text, so the AI sees the coupling, cycles and complexity the user sees.
use crate::{review::build_review, types::{DependencyKind, DiffLineKind, Dependency, Member, MapBox, ChangeStatus, MemberKind, BoxKind}};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

/// A count per name, e.g. links per kind.
type Counts<'a> = BTreeMap<&'a str, usize>;
/// Each box's distinct neighbours: the boxes it links to.
type Graph<'a> = BTreeMap<&'a str, BTreeSet<&'a str>>;

/// How many links leave a box and how many arrive at it.
#[derive(Default, Clone, Copy)]
struct LinkCount { outgoing: usize, incoming: usize }

/// What one box looks like zoomed in: which of its children link outside it, the outside boxes they link to, the
/// boxes those sit in, and how many links leave and arrive.
#[derive(Default)]
struct ZoomView<'a> { children_linking_out: BTreeSet<&'a str>, outside_peers: BTreeSet<&'a str>, peer_parents: BTreeSet<&'a str>, links: LinkCount }

/// Zoomed into a top folder: its place in a `Place`'s nesting.
const TOP_FOLDER: usize = 0;
/// Zoomed into a file: its place in a `Place`'s nesting.
const FILE: usize = 1;
/// The zoom levels `visvet graph` reports on.
const LEVELS: [usize; 2] = [TOP_FOLDER, FILE];

/// Where a box, member or file sits on the map.
struct Place<'a> {
    /// The boxes it sits in, outermost first, ending with itself: top folder, file, type or free fn, member.
    nesting: Vec<&'a str>,
    /// Its kind, e.g. "struct", "method" or "file".
    kind: &'a str,
}

/// Every live box's, member's and file's place, by id.
type Places<'a> = HashMap<&'a str, Place<'a>>;

/// Link tallies: per kind, per top-folder pair, per file across top folders, the code links between boxes at each
/// zoom level, the call graph both ways, and each box's zoom view.
#[derive(Default)]
struct Tally<'a> {
    links_per_kind: Counts<'a>,
    /// Links from one top folder to another, per kind.
    top_folder_links: BTreeMap<(&'a str, &'a str), Counts<'a>>,
    /// Per file, its links that leave or enter its top folder.
    cross_folder_links: BTreeMap<&'a str, LinkCount>,
    /// Which box has a code link to which, per zoom level (`TOP_FOLDER`, `FILE`), for finding cycles.
    code_links: [Graph<'a>; 2],
    /// Per function, the functions it calls.
    callees: Graph<'a>,
    /// Per function, the functions that call it.
    callers: Graph<'a>,
    zoom_views: BTreeMap<&'a str, ZoomView<'a>>,
}

/// Prints the map of the change against `base`, each section worst first: totals, top-folder coupling, cycles,
/// files linked across top folders, zoom views, then the most complex and most connected functions. Removed code is left out.
pub fn print(repo_root: &Path, base: &str) -> anyhow::Result<()> {
    let review = build_review(repo_root, base)?;
    let live: Vec<&MapBox> = review.boxes.iter().filter(|map_box| map_box.status != ChangeStatus::Removed).collect();
    let places = places(&live);
    let link_kinds = ["calls", "creates", "has", "implements", "imports", "uses"];
    let mut tally = Tally { links_per_kind: link_kinds.map(|kind| (kind, 0)).into(), ..Default::default() };
    // Both ends must be live: a Markdown link can still name a box the change removed.
    let is_live = |dep: &&Dependency| places.contains_key(dep.from.as_str()) && places.contains_key(dep.to.as_str());
    for dep in review.dependencies.iter().filter(is_live) {
        tally.add(dep, &places[dep.from.as_str()], &places[dep.to.as_str()]);
    }
    report(&live, &places, &tally);
    Ok(())
}

/// Where every live box, member and file sits.
fn places<'a>(boxes: &[&'a MapBox]) -> Places<'a> {
    let mut places = HashMap::new();
    for map_box in boxes {
        let file_nesting = vec![map_box.file.top_folder(), map_box.file.as_str()];
        let box_nesting = if map_box.kind() == BoxKind::File { file_nesting.clone() } else { [&file_nesting[..], &[map_box.id.as_str()]].concat() };
        for member in map_box.members().iter().filter(|member| member.status != ChangeStatus::Removed) {
            places.insert(member.id.as_str(), Place { nesting: [&box_nesting[..], &[member.id.as_str()]].concat(), kind: member.kind.label() });
        }
        places.insert(map_box.id.as_str(), Place { nesting: box_nesting, kind: map_box.kind().label() });
        places.insert(map_box.file.as_str(), Place { nesting: file_nesting, kind: "file" });
    }
    places
}

impl<'a> Tally<'a> {
    /// Counts dependency `dep`, whose two ends sit at `from` and `to`.
    fn add(&mut self, dep: &'a Dependency, from: &Place<'a>, to: &Place<'a>) {
        *self.links_per_kind.entry(dep.kind.label()).or_default() += 1;
        if dep.kind == DependencyKind::Calls {
            self.callees.entry(dep.from.as_str()).or_default().insert(dep.to.as_str());
            self.callers.entry(dep.to.as_str()).or_default().insert(dep.from.as_str());
        }
        for level in LEVELS {
            let (from_box, to_box) = (from.nesting[level], to.nesting[level]);
            // Both ends in one box: at this level it links nothing.
            if from_box == to_box {
                continue;
            }
            if dep.kind.counts_for_cycles() {
                self.code_links[level].entry(from_box).or_default().insert(to_box);
            }
            if level == TOP_FOLDER {
                *self.top_folder_links.entry((from_box, to_box)).or_default().entry(dep.kind.label()).or_default() += 1;
                self.cross_folder_links.entry(from.nesting[FILE]).or_default().outgoing += 1;
                self.cross_folder_links.entry(to.nesting[FILE]).or_default().incoming += 1;
            }
            self.add_zoom(level, from, to);
        }
    }

    /// Records a link in the zoom view of each end's box at `level`. Zoomed into one end's box, the other end shows
    /// as its box at the same depth, inside that box's parent.
    fn add_zoom(&mut self, level: usize, from: &Place<'a>, to: &Place<'a>) {
        for (inside, outside, leaves) in [(from, to, true), (to, from, false)] {
            let inside_depth = drawn_depth(level, inside);
            let outside_depth = inside_depth.min(outside.nesting.len() - 1);
            let view = self.zoom_views.entry(inside.nesting[level]).or_default();
            view.children_linking_out.extend((inside_depth > level).then(|| inside.nesting[inside_depth]));
            view.peer_parents.extend((outside_depth > level).then(|| outside.nesting[outside_depth - 1]));
            view.outside_peers.insert(outside.nesting[outside_depth]);
            if leaves { view.links.outgoing += 1 } else { view.links.incoming += 1 }
        }
    }
}

/// Prints the sections from the tallies.
fn report(boxes: &[&MapBox], places: &Places, tally: &Tally) {
    let is_function = |member: &&Member| places.contains_key(member.id.as_str()) && matches!(member.kind, MemberKind::Fn | MemberKind::Method);
    let functions: Vec<&Member> = boxes.iter().flat_map(|map_box| map_box.members()).filter(is_function).collect();
    let files: BTreeSet<&str> = boxes.iter().map(|map_box| map_box.file.as_str()).collect();
    let top_folders = boxes.iter().map(|map_box| map_box.file.top_folder()).collect::<BTreeSet<_>>().len();
    let types = boxes.iter().filter(|map_box| map_box.kind() != BoxKind::File).count();
    println!("totals: {top_folders} top folders, {} files, {types} types, {} functions; links: {}", files.len(), functions.len(), list(&tally.links_per_kind));
    section("top-folder coupling (from -> to)", usize::MAX, tally.top_folder_links.iter().map(|((from, to), per_kind)| {
        (per_kind.values().sum::<usize>(), format!("{from} -> {to}: {}", list(per_kind)))
    }));
    for (level, name) in [(FILE, "files"), (TOP_FOLDER, "top folders")] {
        section(&format!("cycles among {name}"), usize::MAX, cycles(&tally.code_links[level]).into_iter().map(|cycle| (cycle.len(), cycle.join(", "))));
    }
    section("files with the most links across top folders", 10, tally.cross_folder_links.iter().map(|(file, links)| {
        (links.outgoing + links.incoming, format!("{file}: {} out, {} in", links.outgoing, links.incoming))
    }));
    let drawn_children = drawn_children(places);
    section("zoom views (what each box looks like zoomed in)", 10, tally.zoom_views.iter().map(|(zoomed, view)| {
        let (links, children, peers) = (view.links, drawn_children.get(zoomed).unwrap_or(&0), view.outside_peers.len());
        let text = format!("{zoomed}: {} of {children} children link out, to {peers} peers in {} boxes ({} out, {} in)",
            view.children_linking_out.len(), view.peer_parents.len(), links.outgoing, links.incoming);
        (peers + links.outgoing + links.incoming, text)
    }));
    let lines = |function: &Member| function.diff.iter().filter(|line| line.kind != DiffLineKind::Removed).count();
    section("most complex functions (complexity, lines)", 10, functions.iter().map(|function| {
        ((function.complexity, lines(function)), format!("{:>3} {:>4}  {}", function.complexity, lines(function), function.id))
    }));
    for (title, graph) in [("most callees (fan-out)", &tally.callees), ("most callers (fan-in)", &tally.callers)] {
        section(title, 10, graph.iter().map(|(function, linked)| (linked.len(), format!("{:>3}  {function}", linked.len()))));
    }
}

/// Per top-folder and file box, how many things inside it are drawn as boxes of their own when zoomed in.
fn drawn_children<'a>(places: &Places<'a>) -> Counts<'a> {
    let mut counts = Counts::new();
    for place in places.values() {
        let own_depth = place.nesting.len() - 1;
        for level in LEVELS.into_iter().filter(|&level| own_depth > level && drawn_depth(level, place) == own_depth) {
            *counts.entry(place.nesting[level]).or_default() += 1;
        }
    }
    counts
}

/// How deep in its nesting the map draws a thing, zoomed into its box at `level`: a folder shows files and types,
/// a file also functions and methods. Other members are drawn as the box they sit in.
fn drawn_depth(level: usize, place: &Place) -> usize {
    let is_member = matches!(place.kind, "fn" | "method" | "field" | "variant");
    let is_function = matches!(place.kind, "fn" | "method");
    let has_own_box = !is_member || level == FILE && is_function;
    place.nesting.len() - if has_own_box { 1 } else { 2 }
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

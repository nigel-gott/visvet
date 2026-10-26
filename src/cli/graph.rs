//! `visvet graph`: the review map as text, so the AI sees the coupling, cycles and complexity the user sees.
use crate::{review::build_review, types::{DependencyKind, DiffLineKind, Dependency, Member, MapBox, ChangeStatus, MemberKind, BoxKind, RepoPath}};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

/// A count per name, e.g. links per kind.
type Counts<'a> = BTreeMap<&'a str, usize>;
/// Each node's distinct neighbours.
type Graph<'a> = BTreeMap<&'a str, BTreeSet<&'a str>>;

/// One box zoomed in: its children with outside links, their peers outside, the peers' parent boxes, links [out, in].
#[derive(Default)]
struct Zoom<'a> { linked: BTreeSet<&'a str>, peers: BTreeSet<&'a str>, boxes: BTreeSet<&'a str>, links: [usize; 2] }

/// Each box's kind and the boxes it sits in, outermost first: top folder, file, type or free fn, member.
type Paths<'a> = HashMap<&'a str, (Vec<&'a str>, &'a str)>;

/// Link tallies: per kind, per top-folder pair, per file across top folders [out, in], the top-folder and file
/// dependency graphs, the call graph [callees, callers], and each box's zoom view.
#[derive(Default)]
struct Tally<'a> {
    kinds: Counts<'a>,
    pairs: BTreeMap<(&'a str, &'a str), Counts<'a>>,
    cross: BTreeMap<&'a str, [usize; 2]>,
    deps: [Graph<'a>; 2],
    calls: [Graph<'a>; 2],
    zoom: BTreeMap<&'a str, Zoom<'a>>,
    /// Each file's path, by its id.
    files: HashMap<&'a str, &'a RepoPath>,
}

/// Prints the map of the change against `base`, each section worst first: totals, top-folder coupling, cycles,
/// files linked across top folders, zoom views, then the most complex and most connected functions. Removed code is left out.
pub fn print(repo_root: &Path, base: &str) -> anyhow::Result<()> {
    let m = build_review(repo_root, base)?;
    let objs: Vec<&MapBox> = m.boxes.iter().filter(|o| o.status != ChangeStatus::Removed).collect();
    let path = paths(&objs);
    let files = objs.iter().map(|o| (o.file.as_str(), &o.file)).collect();
    let mut t = Tally { kinds: ["calls", "creates", "has", "implements", "imports", "uses"].map(|k| (k, 0)).into(), files, ..Default::default() };
    // Both ends must be live: a Markdown link can still name a box the change removed.
    for e in m.dependencies.iter().filter(|e| path.contains_key(e.from.as_str()) && path.contains_key(e.to.as_str())) {
        t.add(e, [&path[e.from.as_str()], &path[e.to.as_str()]]);
    }
    report(&objs, &path, &t);
    Ok(())
}

/// The path and kind of every live object, member and file box.
fn paths<'a>(objs: &[&'a MapBox]) -> Paths<'a> {
    let mut path = HashMap::new();
    for o in objs {
        let f = vec![o.file.top_folder(), o.file.as_str()];
        let p = if o.kind() == BoxKind::File { f.clone() } else { [&f[..], &[o.id.as_str()]].concat() };
        for x in o.members().iter().filter(|x| x.status != ChangeStatus::Removed) {
            path.insert(x.id.as_str(), ([&p[..], &[x.id.as_str()]].concat(), x.kind.label()));
        }
        path.insert(o.id.as_str(), (p, o.kind().label()));
        path.insert(o.file.as_str(), (f, "file"));
    }
    path
}

impl<'a> Tally<'a> {
    /// Counts edge `e` whose ends have these paths.
    fn add(&mut self, e: &'a Dependency, ends: [&(Vec<&'a str>, &'a str); 2]) {
        *self.kinds.entry(e.kind.label()).or_default() += 1;
        if e.kind == DependencyKind::Calls {
            self.calls[0].entry(e.from.as_str()).or_default().insert(e.to.as_str());
            self.calls[1].entry(e.to.as_str()).or_default().insert(e.from.as_str());
        }
        // Level 0 is top folders, 1 is files.
        for k in 0..2 {
            let (a, b) = (ends[0].0[k], ends[1].0[k]);
            if a == b {
                continue;
            }
            let submodule = |file: &str, parent: &str| self.files[file].in_submodule_of(self.files[parent]);
            if e.kind.counts_for_cycles() && !(k == 1 && (submodule(a, b) || submodule(b, a))) {
                self.deps[k].entry(a).or_default().insert(b);
            }
            if k == 0 {
                *self.pairs.entry((a, b)).or_default().entry(e.kind.label()).or_default() += 1;
                self.cross.entry(ends[0].0[1]).or_default()[0] += 1;
                self.cross.entry(ends[1].0[1]).or_default()[1] += 1;
            }
            self.add_zoom(k, ends);
        }
    }

    /// Zoomed into either end's level-`k` box, the other end shows as its box at the same depth, inside that box's parent.
    fn add_zoom(&mut self, k: usize, ends: [&(Vec<&'a str>, &'a str); 2]) {
        for (i, ((p, kind), q)) in [(ends[0], &ends[1].0), (ends[1], &ends[0].0)].into_iter().enumerate() {
            let d = drawn(k, p, kind);
            let (j, z) = (d.min(q.len() - 1), self.zoom.entry(p[k]).or_default());
            z.linked.extend((d > k).then(|| p[d]));
            z.boxes.extend((j > k).then(|| q[j - 1]));
            z.peers.insert(q[j]);
            z.links[i] += 1;
        }
    }
}

/// Prints the sections from the tallies.
fn report(objs: &[&MapBox], path: &Paths, t: &Tally) {
    let fns: Vec<&Member> = objs.iter().flat_map(|o| o.members()).filter(|x| path.contains_key(x.id.as_str()) && matches!(x.kind, MemberKind::Fn | MemberKind::Method)).collect();
    let files: BTreeSet<&str> = objs.iter().map(|o| o.file.as_str()).collect();
    let tops = objs.iter().map(|o| o.file.top_folder()).collect::<BTreeSet<_>>().len();
    let types = objs.iter().filter(|o| o.kind() != BoxKind::File).count();
    println!("totals: {tops} top folders, {} files, {types} types, {} functions; links: {}", files.len(), fns.len(), list(&t.kinds));
    section("top-folder coupling (from -> to)", usize::MAX, t.pairs.iter().map(|((a, b), c)| (c.values().sum::<usize>(), format!("{a} -> {b}: {}", list(c)))));
    for (k, level) in [(1, "files"), (0, "top folders")] {
        section(&format!("cycles among {level}"), usize::MAX, cycles(&t.deps[k]).into_iter().map(|c| (c.len(), c.join(", "))));
    }
    section("files with the most links across top folders", 10, t.cross.iter().map(|(f, [o, i])| (o + i, format!("{f}: {o} out, {i} in"))));
    let kids = kids(path);
    section("zoom views (what each box looks like zoomed in)", 10, t.zoom.iter().map(|(b, z)| {
        let ([o, i], n, p) = (z.links, kids.get(b).unwrap_or(&0), z.peers.len());
        (p + o + i, format!("{b}: {} of {n} children link out, to {p} peers in {} boxes ({o} out, {i} in)", z.linked.len(), z.boxes.len()))
    }));
    let lines = |x: &Member| x.diff.iter().filter(|d| d.kind != DiffLineKind::Removed).count();
    section("most complex functions (complexity, lines)", 10, fns.iter().map(|x| ((x.complexity, lines(x)), format!("{:>3} {:>4}  {}", x.complexity, lines(x), x.id))));
    for (title, g) in [("most callees (fan-out)", &t.calls[0]), ("most callers (fan-in)", &t.calls[1])] {
        section(title, 10, g.iter().map(|(id, s)| (s.len(), format!("{:>3}  {id}", s.len()))));
    }
}

/// Per top-folder and file box, how many nodes inside it are drawn as themselves when zoomed in.
fn kids<'a>(path: &Paths<'a>) -> Counts<'a> {
    let mut kids = Counts::new();
    for (p, kind) in path.values() {
        for k in (0..2).filter(|&k| p.len() > k + 1 && drawn(k, p, kind) == p.len() - 1) {
            *kids.entry(p[k]).or_default() += 1;
        }
    }
    kids
}

/// The depth at which the map draws a node, zoomed into its level-`k` box (0 top folder, 1 file): a folder shows files
/// and types, a file also fns and methods. Other members are drawn as the box they sit in.
fn drawn(k: usize, p: &[&str], kind: &str) -> usize {
    let own = !matches!(kind, "fn" | "method" | "field" | "variant") || k == 1 && matches!(kind, "fn" | "method");
    p.len() - if own { 1 } else { 2 }
}

/// Groups of two or more nodes that all reach each other: the strongly connected components.
fn cycles<'a>(g: &Graph<'a>) -> Vec<Vec<&'a str>> {
    let reach = |a: &'a str| {
        let (mut seen, mut todo) = (BTreeSet::new(), vec![a]);
        while let Some(n) = todo.pop() {
            todo.extend(g.get(n).into_iter().flatten().copied().filter(|b| seen.insert(*b)));
        }
        seen
    };
    let r: BTreeMap<_, _> = g.keys().map(|&a| (a, reach(a))).collect();
    let mut out: Vec<Vec<&str>> = vec![];
    for (a, ra) in &r {
        if ra.contains(a) && !out.iter().any(|c| c.contains(a)) {
            out.push(r.iter().filter(|(b, rb)| ra.contains(*b) && rb.contains(a)).map(|(b, _)| *b).collect());
        }
    }
    out
}

/// Counts as "8 calls, 2 has".
fn list(c: &Counts) -> String {
    c.iter().map(|(k, n)| format!("{n} {k}")).collect::<Vec<_>>().join(", ")
}

/// Prints `title`, then its first `n` rows by key, highest first.
fn section<K: Ord>(title: &str, n: usize, rows: impl Iterator<Item = (K, String)>) {
    let mut rows: Vec<_> = rows.collect();
    rows.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
    println!("{title}:{}", if rows.is_empty() { " none" } else { "" });
    rows.iter().take(n).for_each(|(_, r)| println!("  {r}"));
}

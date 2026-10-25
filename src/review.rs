//! Building the `Review`: reads every file from the working tree and from git at `base`, compares each file's two
//! versions, then finds the dependencies between all the boxes.
use crate::{compare::compare_file, dependencies::find_dependencies, git, visvet_dir};
use crate::types::{GitRef, RepoPath, Review};
use std::collections::{BTreeSet, HashSet};
use std::path::Path;

/// Builds the `Review` for `repo_root`: the working tree compared against git ref `base`.
/// Leaves `annotations` empty; the caller fills it from the store.
pub fn build_review(repo_root: &Path, base: &str) -> anyhow::Result<Review> {
    let cur: HashSet<String> = git::current_files(repo_root)?.into_iter().collect();
    let old: HashSet<String> = git::base_files(repo_root, base)?.into_iter().collect();
    let diffs: Option<HashSet<String>> = git::changed(repo_root, base).map(HashSet::from_iter);
    let mut all = vec![];
    // visvet's own folder holds review state (threads in the drawer), not code for the map.
    for f in cur.union(&old).filter(|f| !visvet_dir::holds(Path::new(f))).collect::<BTreeSet<_>>() {
        let new = cur.contains(f).then(|| std::fs::read(repo_root.join(f)).ok()).flatten();
        let same = diffs.as_ref().is_some_and(|d| !d.contains(f));
        let prev = if !old.contains(f) { None } else if same { new.clone() } else { git::show(repo_root, base, f) };
        all.extend(compare_file(&RepoPath(f.into()), new.as_deref(), prev.as_deref()));
    }
    let (boxes, dependencies) = find_dependencies(all, &cur);
    Ok(Review { compared_against: GitRef(base.into()), boxes, dependencies, ..Default::default() })
}


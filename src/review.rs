//! Building the `Review`: reads every file from the working tree and from git at `base`, compares each file's two
//! versions, then finds the dependencies between all the boxes. Each step is a module below.
pub mod codegen;
pub mod compare;
pub mod coverage;
pub mod dependencies;
pub mod markdown;
pub mod parse;
pub mod tours;

use crate::{git::GitRepo, state::visvet_dir};
use compare::compare_file;
use dependencies::find_dependencies;
use crate::types::{GitRef, RepoPath, Review};
use std::collections::{BTreeSet, HashSet};
use std::path::Path;

/// Builds the `Review` for `repo_root`: the working tree compared against git ref `base`.
/// Leaves `annotations` empty; the caller fills it from the store.
pub fn build_review(repo_root: &Path, base: &str) -> anyhow::Result<Review> {
    let repo = GitRepo::open(repo_root)?;
    let cur: HashSet<RepoPath> = repo.current_files()?.into_iter().collect();
    let old: HashSet<RepoPath> = repo.base_files(base)?.into_iter().collect();
    let diffs: Option<HashSet<RepoPath>> = repo.changed(base).map(HashSet::from_iter);
    let mut all = vec![];
    // visvet's own folder holds review state (threads in the drawer), not code for the map.
    for f in cur.union(&old).filter(|f| !visvet_dir::holds(&f.0)).collect::<BTreeSet<_>>() {
        let new = cur.contains(f).then(|| std::fs::read(repo_root.join(&f.0)).ok()).flatten();
        let same = diffs.as_ref().is_some_and(|d| !d.contains(f));
        let prev = if !old.contains(f) { None } else if same { new.clone() } else { repo.show(base, f) };
        all.extend(compare_file(f, new.as_deref(), prev.as_deref()));
    }
    let (boxes, dependencies) = find_dependencies(all, &cur);
    let tours = tours::read_tours(repo_root, &boxes);
    Ok(Review { compared_against: GitRef(base.into()), boxes, dependencies, tours, ..Default::default() })
}


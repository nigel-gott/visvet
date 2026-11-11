//! `visvet reviewed`: the user marks files as reviewed from the command line, and sees how far the review is.
use crate::git::GitRepo;
use crate::state::reviewed;
use crate::types::{RepoPath, ReviewedState};
use std::collections::HashMap;
use std::path::{Path, PathBuf};

/// Marks every file at or under `paths` as reviewed, or with `undo`, unmarks it; then prints the progress. With
/// `list`, or with no paths, first prints every file on the map: "✓" reviewed, "~" changed since it was, " " not yet.
pub fn run(repo_root: &Path, paths: Vec<PathBuf>, undo: bool, list: bool) -> anyhow::Result<()> {
    let paths: Vec<RepoPath> = paths.into_iter().map(RepoPath).collect();
    if !paths.is_empty() {
        let marked = reviewed::set(repo_root, &paths, !undo)?;
        anyhow::ensure!(marked > 0, "no file on the map at or under those paths; give them from the repository's top folder");
    }
    if list || paths.is_empty() {
        let states: HashMap<RepoPath, ReviewedState> = reviewed::files(repo_root)?.into_iter().map(|file| (file.file, file.state)).collect();
        let mut files = reviewed::map_files(&GitRepo::open(repo_root)?)?;
        files.sort();
        for file in files {
            let mark = match states.get(&file) { Some(ReviewedState::Reviewed) => "✓", Some(ReviewedState::Changed) => "~", None => " " };
            println!("{mark} {file}");
        }
    }
    println!("{}", reviewed::progress(repo_root)?);
    Ok(())
}

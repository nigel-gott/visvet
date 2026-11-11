//! `visvet importance`: the AI rates how important it is that the user understands a file or folder, and sees what
//! is rated so far.
use crate::state::importance;
use crate::types::{Importance, RepoPath};
use std::path::Path;

/// A new rating from the command line.
pub struct NewRating { pub path: RepoPath, pub score: Importance, pub reason: String }

/// Saves `new`, if one was given. Otherwise prints every file on the map with the score that holds for it, most
/// important first, then the files nothing rates yet.
pub fn run(repo_root: &Path, new: Option<NewRating>) -> anyhow::Result<()> {
    if let Some(NewRating { path, score, reason }) = new {
        return importance::rate(repo_root, path, score, reason);
    }
    let (mut rated, unrated): (Vec<_>, Vec<_>) = importance::files(repo_root)?.into_iter().partition(|(_, importance)| importance.is_some());
    rated.sort_by_key(|(_, importance)| std::cmp::Reverse(importance.as_ref().map(|importance| importance.score)));
    for (file, importance) in rated {
        println!("{:>3} {file}", importance.map_or(0, |importance| importance.score.0));
    }
    for (file, _) in &unrated {
        println!("  ? {file}");
    }
    println!("{} files not rated", unrated.len());
    Ok(())
}

//! How important the AI thinks it is that the user understands each file, 0 to 100, with a one-line reason, in
//! `.visvet/importance`: one JSON line per rated file or folder, sorted by path, committed with the code. A folder's
//! rating holds for every file under it that has no closer rating of its own. The AI writes them (`visvet importance`).
use crate::git::GitRepo;
use crate::state::{reviewed, visvet_dir::VisvetDir};
use crate::types::{FileImportance, Importance, RepoPath};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::{fs, path::Path};

/// One line of the file: the rating of the file or folder at `path`.
#[derive(Serialize, Deserialize, Clone)]
struct Rating { path: RepoPath, score: Importance, reason: String }

/// Reads the ratings; a missing file means none. A line that isn't a rating (say, left by a merge conflict) is skipped.
fn read(repo_root: &Path) -> Vec<Rating> {
    let text = fs::read_to_string(VisvetDir::of(repo_root).importance()).unwrap_or_default();
    text.lines().filter_map(|line| serde_json::from_str(line).ok()).collect()
}

/// The rating that holds for `file`: its own, else that of the closest folder around it that has one.
fn rating_of<'r>(ratings: &'r [Rating], file: &RepoPath) -> Option<&'r Rating> {
    let folders_deep = |rating: &&Rating| rating.path.0.components().count();
    ratings.iter().filter(|rating| file.0.starts_with(&rating.path.0)).max_by_key(folders_deep)
}

/// Each file on the map, by path, with the rating that holds for it; none for a file nothing rates.
pub fn files(repo_root: &Path) -> Result<Vec<(RepoPath, Option<FileImportance>)>> {
    let ratings = read(repo_root);
    let mut files = reviewed::map_files(&GitRepo::open(repo_root)?)?;
    files.sort();
    let rated = |file: RepoPath| {
        let importance = rating_of(&ratings, &file).map(|rating| FileImportance { file: file.clone(), score: rating.score, reason: rating.reason.clone() });
        (file, importance)
    };
    Ok(files.into_iter().map(rated).collect())
}

/// Rates the file or folder at `path`, in place of any rating it had.
pub fn rate(repo_root: &Path, path: RepoPath, score: Importance, reason: String) -> Result<()> {
    let dir = VisvetDir::of(repo_root);
    // Held until this returns, so two writers never lose each other's ratings.
    let lock = fs::File::open(dir.create()?)?;
    lock.lock()?;
    let is_on_map = reviewed::map_files(&GitRepo::open(repo_root)?)?.iter().any(|file| file.0.starts_with(&path.0));
    anyhow::ensure!(is_on_map, "no file on the map at or under {path}; give the path from the repository's top folder");
    let mut ratings = read(repo_root);
    ratings.retain(|rating| rating.path != path);
    ratings.push(Rating { path, score, reason });
    ratings.sort_by(|one, other| one.path.cmp(&other.path));
    let lines: String = ratings.iter().map(|rating| Ok(serde_json::to_string(rating)? + "\n")).collect::<Result<_>>()?;
    Ok(fs::write(dir.importance(), lines)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_takes_the_closest_rating_around_it() {
        let root = std::env::temp_dir().join(format!("visvet-importance-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        git2::Repository::init(&root).unwrap();
        for file in ["a.rs", "src/b.rs", "src/deep/c.rs", "srcs.rs"] {
            fs::create_dir_all(root.join(file).parent().unwrap()).unwrap();
            fs::write(root.join(file), "text").unwrap();
        }
        let rate = |path: &str, score: u8| rate(&root, RepoPath(path.into()), Importance(score), format!("why {path}"));
        rate("src/", 40).unwrap();
        rate("src/deep/c.rs", 90).unwrap();
        rate("src", 50).unwrap();
        assert!(rate("gone.rs", 10).is_err());
        let scores: Vec<(String, Option<u8>)> = files(&root).unwrap().into_iter().map(|(file, rated)| (file.to_string(), rated.map(|rated| rated.score.0))).collect();
        assert_eq!(scores, [("a.rs".into(), None), ("src/b.rs".into(), Some(50)), ("src/deep/c.rs".into(), Some(90)), ("srcs.rs".into(), None)]);
        // One line per rating, and a line a merge conflict left is skipped.
        let saved = fs::read_to_string(root.join(".visvet/importance")).unwrap();
        assert_eq!(saved.lines().count(), 2);
        fs::write(root.join(".visvet/importance"), format!("<<<<<<< ours\n{saved}")).unwrap();
        assert_eq!(files(&root).unwrap().into_iter().filter(|(_, rated)| rated.is_some()).count(), 2);
        fs::remove_dir_all(root).unwrap();
    }
}

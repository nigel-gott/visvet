//! Fog of war: the lines of each file the user has had on screen while active, in `.visvet/explored/`, local to this
//! machine. One small record per file content, named by the content's git blob id and holding the numbers of the
//! lines seen. So a new version of a file starts unexplored by itself, and a moved or restored file stays explored.
use crate::git::GitRepo;
use crate::state::{reviewed, visvet_dir::VisvetDir};
use crate::types::{ExploredFile, RepoPath};
use anyhow::Result;
use serde::Deserialize;
use std::collections::BTreeSet;
use std::{fs, path::{Path, PathBuf}};

/// Lines of `file` the user has on screen now, by number.
#[derive(Deserialize)]
pub struct LinesOnScreen { pub file: RepoPath, pub lines: Vec<u32> }

/// Where the lines seen of the content `file` has now are kept; none if the file can't be read.
fn record_of(git: &GitRepo, repo_root: &Path, file: &RepoPath) -> Option<PathBuf> {
    Some(VisvetDir::of(repo_root).explored().join(git.content_id(file)?.to_string()))
}

/// The line numbers in `record`; none when nothing was seen yet.
fn lines_in(record: &Path) -> BTreeSet<u32> {
    fs::read(record).ok().and_then(|json| serde_json::from_slice(&json).ok()).unwrap_or_default()
}

/// Each file on the map the user has seen lines of, as it is now, and how many.
pub fn files(repo_root: &Path) -> Result<Vec<ExploredFile>> {
    if !VisvetDir::of(repo_root).explored().is_dir() {
        return Ok(vec![]);
    }
    let git = GitRepo::open(repo_root)?;
    // ponytail: reads every file on the map on each load, to find its content id; remember the ids by each file's
    // modification time if that is ever slow on a huge repository.
    let explored = reviewed::map_files(&git)?.into_iter().filter_map(|file| {
        let seen_lines = lines_in(&record_of(&git, repo_root, &file)?).len();
        (seen_lines > 0).then_some(ExploredFile { file, seen_lines })
    });
    Ok(explored.collect())
}

/// Adds the lines the user has on screen to what they have seen of each file. A record is written only when it grows.
pub fn add(repo_root: &Path, on_screen: Vec<LinesOnScreen>) -> Result<()> {
    let dir = VisvetDir::of(repo_root);
    let git = GitRepo::open(repo_root)?;
    for LinesOnScreen { file, lines } in on_screen {
        let Some(record) = record_of(&git, repo_root, &file) else { continue };
        let mut seen = lines_in(&record);
        let seen_before = seen.len();
        seen.extend(lines);
        if seen.len() > seen_before {
            fs::create_dir_all(dir.explored())?;
            // Through a temporary file, so a reader never sees half a record.
            let half_written = dir.create()?.join("explored.tmp");
            fs::write(&half_written, serde_json::to_vec(&seen)?)?;
            fs::rename(half_written, record)?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seen_lines_add_up_and_a_new_version_starts_unexplored() {
        let root = std::env::temp_dir().join(format!("visvet-explored-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        git2::Repository::init(&root).unwrap();
        fs::write(root.join("a.rs"), "one\ntwo\nthree\n").unwrap();
        let see = |lines: &[u32]| add(&root, vec![LinesOnScreen { file: RepoPath("a.rs".into()), lines: lines.to_vec() }]).unwrap();
        let seen = || files(&root).unwrap().into_iter().map(|file| (file.file.to_string(), file.seen_lines)).collect::<Vec<_>>();
        assert_eq!(seen(), []);
        see(&[1, 2]);
        see(&[2, 3]);
        assert_eq!(seen(), [("a.rs".into(), 3)]);
        // A new version is unexplored; the old one, restored or moved, is as explored as it was.
        fs::write(root.join("a.rs"), "one\ntwo, edited\nthree\n").unwrap();
        assert_eq!(seen(), []);
        fs::write(root.join("moved.rs"), "one\ntwo\nthree\n").unwrap();
        assert_eq!(seen(), [("moved.rs".into(), 3)]);
        fs::remove_dir_all(root).unwrap();
    }
}

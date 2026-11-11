//! Fog of war: the lines of each file the user has had on screen while active, in `.visvet/explored/`, local to this
//! machine. One small record per file content, named by the content's git blob id and holding the numbers of the
//! lines seen. So a new version of a file starts unexplored by itself, and a moved or restored file stays explored.
//! Beside them, `.visvet/read-lately` notes when lines were first seen, over the last half hour: the user's reading
//! pace, which holds across page reloads, browsers and devices.
use crate::git::GitRepo;
use crate::state::{reviewed, visvet_dir::VisvetDir};
use crate::types::{ExploredFile, ReadLately, RepoPath};
use anyhow::Result;
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use std::{fs, path::{Path, PathBuf}};

/// The reading pace is taken over this long, up to now; what was read before it is forgotten.
const LATELY: Duration = Duration::from_secs(30 * 60);

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

/// Each time lines were first seen in the last half hour, oldest first: one JSON line each in `.visvet/read-lately`.
fn first_seen_lately(dir: &VisvetDir) -> Vec<ReadLately> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    let earliest = now.saturating_sub(LATELY).as_millis();
    let text = fs::read_to_string(dir.read_lately()).unwrap_or_default();
    text.lines().filter_map(|line| serde_json::from_str::<ReadLately>(line).ok()).filter(|seen| u128::from(seen.at) >= earliest).collect()
}

/// What the user read in the last half hour: per file, how many lines they first saw, and when the first of them.
pub fn read_lately(repo_root: &Path) -> Vec<ReadLately> {
    let mut by_file: BTreeMap<RepoPath, ReadLately> = BTreeMap::new();
    for seen in first_seen_lately(&VisvetDir::of(repo_root)) {
        let file = by_file.entry(seen.file.clone()).or_insert(ReadLately { lines: 0, ..seen });
        file.lines += seen.lines;
    }
    by_file.into_values().collect()
}

/// Adds the lines the user has on screen to what they have seen of each file. A record is written only when it grows,
/// and then how many lines it grew by is noted for the reading pace.
pub fn add(repo_root: &Path, on_screen: Vec<LinesOnScreen>) -> Result<()> {
    let dir = VisvetDir::of(repo_root);
    let git = GitRepo::open(repo_root)?;
    let now = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    let mut first_seen_now = vec![];
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
            first_seen_now.push(ReadLately { file, lines: seen.len() - seen_before, at: now });
        }
    }
    if !first_seen_now.is_empty() {
        let lately = first_seen_lately(&dir).into_iter().chain(first_seen_now);
        let lines: String = lately.map(|seen| Ok(serde_json::to_string(&seen)? + "\n")).collect::<Result<_>>()?;
        fs::write(dir.read_lately(), lines)?;
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
        // The pace: 2 lines first seen, then 1 more, together as the file's 3; lines seen again count for nothing.
        see(&[1, 3]);
        let lately = read_lately(&root);
        assert_eq!(lately.iter().map(|read| (read.file.to_string(), read.lines)).collect::<Vec<_>>(), [("a.rs".into(), 3)]);
        // What was first seen more than half an hour ago is forgotten.
        fs::write(root.join(".visvet/read-lately"), r#"{"file":"a.rs","lines":3,"at":1000}"#).unwrap();
        assert!(read_lately(&root).is_empty());
        // A new version is unexplored; the old one, restored or moved, is as explored as it was.
        fs::write(root.join("a.rs"), "one\ntwo, edited\nthree\n").unwrap();
        assert_eq!(seen(), []);
        fs::write(root.join("moved.rs"), "one\ntwo\nthree\n").unwrap();
        assert_eq!(seen(), [("moved.rs".into(), 3)]);
        fs::remove_dir_all(root).unwrap();
    }
}

//! The files the user has marked as reviewed, in `.visvet/reviewed`: one line per file, "<content id> <path>", sorted
//! by path, and committed with the code like the threads. A mark records what was reviewed, the file's content then
//! (its git blob id), so a file that changes afterwards shows as changed since, and a file that moves with the same
//! content keeps its mark. The marks are the user's: only the UI's toggle and `visvet reviewed` write them.
use crate::git::{ContentId, GitRepo};
use crate::state::visvet_dir::{self, VisvetDir};
use crate::types::{RepoPath, ReviewedFile, ReviewedState};
use anyhow::Result;
use std::collections::{BTreeMap, BTreeSet, HashSet};
use std::{fs, path::Path};

/// One line of the file: `file` was reviewed when its content was `content`. After a git merge a file can have two.
#[derive(Clone, PartialEq, Eq, PartialOrd, Ord)]
struct Mark { file: RepoPath, content: ContentId }

/// Reads the marks; a missing file means none. A line that isn't a mark (say, left by a merge conflict) is skipped.
fn read(repo_root: &Path) -> BTreeSet<Mark> {
    let text = fs::read_to_string(VisvetDir::of(repo_root).reviewed()).unwrap_or_default();
    let mark = |line: &str| {
        let (content, file) = line.split_once(' ')?;
        Some(Mark { file: RepoPath(file.into()), content: ContentId::parse(content)? })
    };
    text.lines().filter_map(mark).collect()
}

/// The files that can be marked: the ones the map shows a box for, i.e. every file there is now outside `.visvet/`.
pub fn map_files(git: &GitRepo) -> Result<Vec<RepoPath>> {
    Ok(git.current_files()?.into_iter().filter(|file| !visvet_dir::holds(&file.0)).collect())
}

/// The marks as they stand for the files there are now: a mark whose file is gone is dropped, unless a file with no
/// mark has exactly the content that was reviewed; then the file moved, and its mark moves with it.
fn settle(git: &GitRepo, repo_root: &Path, marks: BTreeSet<Mark>) -> Result<BTreeSet<Mark>> {
    let (kept, lost): (BTreeSet<Mark>, BTreeSet<Mark>) = marks.into_iter().partition(|mark| repo_root.join(&mark.file.0).is_file());
    if lost.is_empty() {
        return Ok(kept);
    }
    let marked: HashSet<&RepoPath> = kept.iter().map(|mark| &mark.file).collect();
    let lost_content: HashSet<ContentId> = lost.iter().map(|mark| mark.content).collect();
    // ponytail: reads every unmarked file while a marked file is missing (until the next mark is written); index
    // the files by size first if that is ever slow on a huge repository.
    let moved: Vec<Mark> = map_files(git)?.into_iter().filter(|file| !marked.contains(file))
        .filter_map(|file| Some(Mark { content: git.content_id(&file)?, file }))
        .filter(|mark| lost_content.contains(&mark.content)).collect();
    Ok(kept.into_iter().chain(moved).collect())
}

/// Each marked file there is now, by path, and whether it changed since it was reviewed.
pub fn files(repo_root: &Path) -> Result<Vec<ReviewedFile>> {
    let git = GitRepo::open(repo_root)?;
    let mut states = BTreeMap::new();
    for mark in settle(&git, repo_root, read(repo_root))? {
        let is_as_reviewed = git.content_id(&mark.file) == Some(mark.content);
        let state = states.entry(mark.file).or_insert(ReviewedState::Changed);
        if is_as_reviewed {
            *state = ReviewedState::Reviewed;
        }
    }
    Ok(states.into_iter().map(|(file, state)| ReviewedFile { file, state }).collect())
}

/// Marks every file on the map at or under one of `paths` (files or folders) as reviewed with the content it has
/// now, or with `reviewed` false, removes its mark. Returns how many files that was.
pub fn set(repo_root: &Path, paths: &[RepoPath], reviewed: bool) -> Result<usize> {
    let dir = VisvetDir::of(repo_root);
    // Held until this returns, so two writers never lose each other's marks.
    let lock = fs::File::open(dir.create()?)?;
    lock.lock()?;
    let git = GitRepo::open(repo_root)?;
    let chosen: Vec<RepoPath> = map_files(&git)?.into_iter().filter(|file| paths.iter().any(|path| file.0.starts_with(&path.0))).collect();
    let mut marks = settle(&git, repo_root, read(repo_root))?;
    marks.retain(|mark| !chosen.contains(&mark.file));
    if reviewed {
        marks.extend(chosen.iter().filter_map(|file| Some(Mark { file: file.clone(), content: git.keep_content(file)? })));
    }
    let lines: String = marks.iter().map(|mark| format!("{} {}\n", mark.content, mark.file)).collect();
    fs::write(dir.reviewed(), lines)?;
    Ok(chosen.len())
}

/// The content `file` had when it was marked as reviewed; none if it has no mark, or git no longer has that content.
pub fn content_reviewed(repo_root: &Path, file: &RepoPath) -> Result<Option<Vec<u8>>> {
    let git = GitRepo::open(repo_root)?;
    let mark = settle(&git, repo_root, read(repo_root))?.into_iter().find(|mark| &mark.file == file);
    Ok(mark.and_then(|mark| git.content(mark.content)))
}

/// How far the review is, e.g. "7/12 files reviewed, 1 changed since".
pub fn progress(repo_root: &Path) -> Result<String> {
    let total = map_files(&GitRepo::open(repo_root)?)?.len();
    let marked = files(repo_root)?;
    let changed = marked.iter().filter(|file| file.state == ReviewedState::Changed).count();
    Ok(format!("{}/{total} files reviewed, {changed} changed since", marked.len() - changed))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ReviewedState::{Changed, Reviewed};

    /// An empty git repository holding `files`, each with its text.
    fn repo(name: &str, files: &[(&str, &str)]) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!("visvet-reviewed-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        git2::Repository::init(&root).unwrap();
        for (file, text) in files {
            fs::create_dir_all(root.join(file).parent().unwrap()).unwrap();
            fs::write(root.join(file), text).unwrap();
        }
        root
    }

    /// The marked files and their states, as text.
    fn states(root: &Path) -> Vec<(String, ReviewedState)> {
        files(root).unwrap().into_iter().map(|file| (file.file.to_string(), file.state)).collect()
    }

    #[test]
    fn a_mark_follows_the_content_it_was_made_on() {
        let root = repo("content", &[("a.rs", "one"), ("src/b.rs", "two"), ("src/c.rs", "three")]);
        let path = |text: &str| RepoPath(text.into());
        assert_eq!(set(&root, &[path("a.rs"), path("src/b.rs")], true).unwrap(), 2);
        assert_eq!(states(&root), [("a.rs".into(), Reviewed), ("src/b.rs".into(), Reviewed)]);
        // One line per file, sorted by path, each starting with the content's git blob id.
        let saved = fs::read_to_string(root.join(".visvet/reviewed")).unwrap();
        let lines: Vec<(&str, &str)> = saved.lines().map(|line| line.split_once(' ').unwrap()).collect();
        assert_eq!(lines.iter().map(|(_, file)| *file).collect::<Vec<_>>(), ["a.rs", "src/b.rs"]);
        assert!(lines.iter().all(|(content, _)| content.len() == 40 && ContentId::parse(content).is_some()));
        // Changed afterwards: the mark stays, as changed since, and git still has what was reviewed.
        fs::write(root.join("a.rs"), "one, edited").unwrap();
        assert_eq!(states(&root)[0], ("a.rs".into(), Changed));
        assert_eq!(content_reviewed(&root, &path("a.rs")).unwrap().unwrap(), b"one");
        // Moved with the same content: the mark moves too. Deleted: the mark drops out.
        fs::rename(root.join("src/b.rs"), root.join("moved.rs")).unwrap();
        fs::remove_file(root.join("a.rs")).unwrap();
        assert_eq!(states(&root), [("moved.rs".into(), Reviewed)]);
        // Unmarking writes the marks as they now stand.
        set(&root, &[path("moved.rs")], false).unwrap();
        assert_eq!(fs::read_to_string(root.join(".visvet/reviewed")).unwrap(), "");
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn a_folder_marks_every_file_under_it_and_merged_lines_are_read() {
        let root = repo("folder", &[("a.rs", "one"), ("src/b.rs", "two"), ("src/deep/c.rs", "three"), ("srcs.rs", "four")]);
        assert_eq!(set(&root, &[RepoPath("src/".into())], true).unwrap(), 2);
        assert_eq!(progress(&root).unwrap(), "2/4 files reviewed, 0 changed since");
        // After a git merge: both sides' marks for one file, and a conflict's marker lines. Either content counts.
        let saved = fs::read_to_string(root.join(".visvet/reviewed")).unwrap();
        let other_side = "<<<<<<< ours\ne69de29bb2d1d6434b8b29ae775ad8c2e48c5391 src/b.rs\n=======\n";
        fs::write(root.join(".visvet/reviewed"), format!("{other_side}{saved}")).unwrap();
        assert_eq!(states(&root), [("src/b.rs".into(), Reviewed), ("src/deep/c.rs".into(), Reviewed)]);
        fs::write(root.join("src/b.rs"), "two, edited").unwrap();
        assert_eq!(progress(&root).unwrap(), "1/4 files reviewed, 1 changed since");
        assert_eq!(set(&root, &[RepoPath("src".into())], false).unwrap(), 2);
        assert_eq!(progress(&root).unwrap(), "0/4 files reviewed, 0 changed since");
        fs::remove_dir_all(root).unwrap();
    }
}

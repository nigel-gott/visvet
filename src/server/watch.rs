//! Watching the repository for changes that alter the review: code, commits and checkouts, comment threads, test
//! coverage, and `visvet show` requests. It knows nothing about how the changes are passed on (today, the HTTP server).
use crate::git::GitRepo;
use crate::state::visvet_dir::{self, HandOff, VisvetDir};
use notify::{RecursiveMode, Watcher};
use std::{path::{Path, PathBuf}, sync::mpsc, time::{Duration, Instant}};

/// A burst of file changes is passed on once none has come for this long,
const QUIET: Duration = Duration::from_millis(150);
/// or once it has lasted this long, so changes that never pause still reach the UI.
const LONGEST_BURST: Duration = Duration::from_secs(1);

/// Something in the repository that the review should react to.
#[derive(Clone)]
pub enum RepoEvent {
    /// Files that make up the review changed, so it should be rebuilt.
    Changed,
    /// Only comment threads changed: the code map stays as it is.
    ThreadsChanged,
    /// `visvet show` asked to navigate somewhere; its JSON.
    Show(String),
}

/// Watches the repository and calls `on` once per burst of file changes that matter (see `QUIET`, `LONGEST_BURST`):
/// with `Show` if `visvet show` wrote `.visvet/show.json`, with `ThreadsChanged` if only comment threads changed, and
/// with `Changed` if any other relevant file did. Changes to other files are dropped as they come: a program that
/// writes all the time into an ignored folder (a database, a build) once kept a burst from ever ending, so the UI
/// never heard of a new comment. Watching stops when the returned watcher is dropped.
pub fn watch(repo_root: PathBuf, on: impl Fn(RepoEvent) + Send + 'static) -> notify::Result<notify::RecommendedWatcher> {
    let (raw_tx, raw_rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(raw_tx)?;
    watcher.watch(&repo_root, RecursiveMode::Recursive)?;
    let show = VisvetDir::of(&repo_root).hand_off(HandOff::Show);
    std::thread::spawn(move || {
        let git = GitRepo::open(&repo_root).ok();
        let matters = |path: &PathBuf| *path == show || relevant(&repo_root, path, git.as_ref());
        // The paths one file event changed, of those that matter.
        let changed_by = |event: notify::Result<notify::Event>| -> Vec<PathBuf> {
            event.ok().filter(|event| !event.kind.is_access()).map(|event| event.paths).unwrap_or_default().into_iter().filter(matters).collect()
        };
        while let Ok(first) = raw_rx.recv() {
            let mut paths = changed_by(first);
            if paths.is_empty() {
                continue;
            }
            let burst_start = Instant::now();
            let mut last_change = burst_start;
            while burst_start.elapsed() < LONGEST_BURST && let Ok(event) = raw_rx.recv_timeout(QUIET.saturating_sub(last_change.elapsed())) {
                let more = changed_by(event);
                if !more.is_empty() {
                    last_change = Instant::now();
                    paths.extend(more);
                }
            }
            if paths.contains(&show) && let Ok(json) = std::fs::read_to_string(&show) {
                on(RepoEvent::Show(json));
            }
            let mut in_review = paths.iter().filter(|path| **path != show).map(|path| path.strip_prefix(&repo_root).unwrap_or(path)).peekable();
            if in_review.peek().is_some() {
                on(if in_review.all(visvet_dir::is_thread) { RepoEvent::ThreadsChanged } else { RepoEvent::Changed });
            }
        }
    });
    Ok(watcher)
}

/// Inside `.git`, only HEAD and ref moves count, so commits and checkouts refresh.
/// Inside `.visvet`, only the comment threads and test coverage count, not the view and show hand-offs.
/// Elsewhere, files that `git`'s ignore rules leave out don't count: they are not on the map.
fn relevant(repo_root: &Path, path: &Path, git: Option<&GitRepo>) -> bool {
    let rel = path.strip_prefix(repo_root).unwrap_or(path);
    if visvet_dir::holds(rel) {
        return visvet_dir::affects_review(rel);
    }
    if let Ok(git) = rel.strip_prefix(".git") {
        return ["HEAD", "packed-refs", "refs"].iter().any(|p| git.starts_with(p));
    }
    let build_output = rel.components().any(|c| matches!(c.as_os_str().to_str(), Some(".git" | "target" | "node_modules")));
    !build_output && !git.is_some_and(|git| git.ignores(rel))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_review_files_count() {
        let r = Path::new("/repo");
        let counts = |p: &str| relevant(r, &r.join(p), None);
        assert!(counts("src/main.rs") && counts(".visvet/threads/k3f9a2/1-ann.md") && counts(".git/HEAD"));
        assert!(visvet_dir::is_thread(Path::new(".visvet/threads/k3f9a2/1-ann.md")) && !visvet_dir::is_thread(Path::new(".visvet/coverage.lcov")));
        assert!(!counts(".visvet/view.json") && !counts("target/debug/visvet") && !counts(".git/index"));
    }
}

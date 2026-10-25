//! Watching the repository for changes that alter the review: code, commits and checkouts, comment threads, test
//! coverage, and `visvet show` requests. It knows nothing about how the changes are passed on (today, the HTTP server).
use crate::visvet_dir::{self, HandOff, VisvetDir};
use notify::{RecursiveMode, Watcher};
use std::{path::{Path, PathBuf}, sync::mpsc, time::Duration};

/// Something in the repository that the review should react to.
#[derive(Clone)]
pub enum RepoEvent {
    /// Files that make up the review changed, so it should be rebuilt.
    Changed,
    /// `visvet show` asked to navigate somewhere; its JSON.
    Show(String),
}

/// Watches the repository and calls `on` once per burst of file events (150ms apart at most): with `Show` if
/// `visvet show` wrote `.visvet/show.json`, and with `Changed` if any other relevant file changed. Watching stops when
/// the returned watcher is dropped.
pub fn watch(repo_root: PathBuf, on: impl Fn(RepoEvent) + Send + 'static) -> notify::Result<notify::RecommendedWatcher> {
    let (raw_tx, raw_rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(raw_tx)?;
    watcher.watch(&repo_root, RecursiveMode::Recursive)?;
    let show = VisvetDir::of(&repo_root).hand_off(HandOff::Show);
    std::thread::spawn(move || {
        while let Ok(first) = raw_rx.recv() {
            let mut burst = vec![first];
            while let Ok(ev) = raw_rx.recv_timeout(Duration::from_millis(150)) {
                burst.push(ev);
            }
            let paths: Vec<PathBuf> = burst.into_iter().flatten().filter(|ev| !ev.kind.is_access()).flat_map(|ev| ev.paths).collect();
            if paths.contains(&show) && let Ok(json) = std::fs::read_to_string(&show) {
                on(RepoEvent::Show(json));
            }
            if paths.iter().any(|p| relevant(&repo_root, p)) {
                on(RepoEvent::Changed);
            }
        }
    });
    Ok(watcher)
}

/// Inside `.git`, only HEAD and ref moves count, so commits and checkouts refresh.
/// Inside `.visvet`, only the comment threads and test coverage count, not the view and show hand-offs.
fn relevant(repo_root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(repo_root).unwrap_or(path);
    if visvet_dir::holds(rel) {
        return visvet_dir::affects_review(rel);
    }
    if let Ok(git) = rel.strip_prefix(".git") {
        return ["HEAD", "packed-refs", "refs"].iter().any(|p| git.starts_with(p));
    }
    !rel.components().any(|c| matches!(c.as_os_str().to_str(), Some(".git" | "target" | "node_modules")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_review_files_count() {
        let r = Path::new("/repo");
        let counts = |p: &str| relevant(r, &r.join(p));
        assert!(counts("src/main.rs") && counts(".visvet/threads/k3f9a2/1-ann.md") && counts(".git/HEAD"));
        assert!(!counts(".visvet/view.json") && !counts("target/debug/visvet") && !counts(".git/index"));
    }
}

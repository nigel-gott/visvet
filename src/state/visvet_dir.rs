//! `.visvet/`: visvet's own folder in a repository, and the one place that knows what is in it. The comment threads
//! are shared through git; everything else in it is local to this machine.
use std::{fs, io, path::{Path, PathBuf}};

/// The folder's name, in the repository's top folder.
pub const NAME: &str = ".visvet";
/// Its `.gitignore`: everything is local except the threads.
const IGNORE: &str = "*\n!.gitignore\n!threads/\n!threads/**\n";

/// A small JSON file passed between the UI and the AI, local to this machine.
#[derive(Clone, Copy)]
pub enum HandOff {
    /// What the user has open, written by the UI for `visvet view`.
    View,
    /// Where `visvet show` asks the UI to go.
    Show,
}

/// `.visvet/` in one repository.
pub struct VisvetDir(PathBuf);

impl VisvetDir {
    /// The folder in the repository at `repo_root`, which may not exist yet.
    pub fn of(repo_root: &Path) -> Self {
        Self(repo_root.join(NAME))
    }

    /// Creates the folder, with its `.gitignore`, if needed.
    pub fn create(&self) -> io::Result<&Path> {
        fs::create_dir_all(self.threads())?;
        if fs::read_to_string(self.0.join(".gitignore")).ok().as_deref() != Some(IGNORE) {
            fs::write(self.0.join(".gitignore"), IGNORE)?;
        }
        Ok(&self.0)
    }

    /// The comment threads, one folder each.
    pub fn threads(&self) -> PathBuf {
        self.0.join("threads")
    }

    /// What each thread's box looked like, so the thread can follow it when it's renamed (see `renames`).
    pub fn anchors(&self) -> PathBuf {
        self.0.join("anchors")
    }

    /// The file for hand-off `h`.
    pub fn hand_off(&self, h: HandOff) -> PathBuf {
        self.0.join(match h { HandOff::View => "view.json", HandOff::Show => "show.json" })
    }

    /// The test coverage from the last `visvet coverage`, as LCOV.
    pub fn coverage(&self) -> PathBuf {
        self.0.join("coverage.lcov")
    }
}

/// Whether `rel`, a path from the repository's top folder, is inside `.visvet/`.
pub fn holds(rel: &Path) -> bool {
    rel.starts_with(NAME)
}

/// Whether a change to `rel`, a path inside `.visvet/`, changes the review: the threads and test coverage do; the
/// hand-offs don't.
pub fn affects_review(rel: &Path) -> bool {
    let own = rel.strip_prefix(NAME).unwrap_or(rel);
    own.starts_with("threads") || own == Path::new("coverage.lcov")
}

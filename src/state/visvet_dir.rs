//! `.visvet/`: visvet's own folder in a repository, and the one place that knows what is in it. The comment threads
//! and the reviewed marks are shared through git; everything else in it is local to this machine.
use std::{fs, io, path::{Path, PathBuf}};

/// The folder's name, in the repository's top folder.
pub const NAME: &str = ".visvet";
/// Its `.gitignore`: everything is local except the threads, the reviewed marks and the importance ratings.
const IGNORE: &str = "*\n!.gitignore\n!.gitattributes\n!reviewed\n!importance\n!threads/\n!threads/**\n";
/// Its `.gitattributes`: when two people mark files as reviewed, or rate them, git merges by keeping both sides' lines.
const ATTRIBUTES: &str = "reviewed merge=union\nimportance merge=union\n";

/// A small JSON file passed between the UI and the AI, local to this machine.
#[derive(Clone, Copy)]
pub enum HandOff {
    /// What the user has open, written by the UI for `visvet view`.
    View,
    /// Where `visvet show` asks the UI to go.
    Show,
    /// The newest message of each thread the AI has been shown, so `visvet reply` never closes a thread over one it
    /// hasn't read.
    ThreadsShownToTheAi,
}

/// `.visvet/` in one repository.
pub struct VisvetDir(PathBuf);

impl VisvetDir {
    /// The folder in the repository at `repo_root`, which may not exist yet.
    pub fn of(repo_root: &Path) -> Self {
        Self(repo_root.join(NAME))
    }

    /// Creates the folder, with its `.gitignore` and `.gitattributes`, if needed.
    pub fn create(&self) -> io::Result<&Path> {
        fs::create_dir_all(self.threads())?;
        for (name, text) in [(".gitignore", IGNORE), (".gitattributes", ATTRIBUTES)] {
            if fs::read_to_string(self.0.join(name)).ok().as_deref() != Some(text) {
                fs::write(self.0.join(name), text)?;
            }
        }
        Ok(&self.0)
    }

    /// The comment threads, one folder each.
    pub fn threads(&self) -> PathBuf {
        self.0.join("threads")
    }

    /// The files the user marked as reviewed, one line each.
    pub fn reviewed(&self) -> PathBuf {
        self.0.join("reviewed")
    }

    /// How important the AI thinks each file is to understand, one line per rated file or folder.
    pub fn importance(&self) -> PathBuf {
        self.0.join("importance")
    }

    /// The lines of each file the user has seen, one record per file content.
    pub fn explored(&self) -> PathBuf {
        self.0.join("explored")
    }

    /// When lines were first seen, over the last half hour: the user's reading pace.
    pub fn read_lately(&self) -> PathBuf {
        self.0.join("read-lately")
    }

    /// The file for hand-off `h`.
    pub fn hand_off(&self, h: HandOff) -> PathBuf {
        self.0.join(match h { HandOff::View => "view.json", HandOff::Show => "show.json", HandOff::ThreadsShownToTheAi => "threads-shown.json" })
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

/// Whether a change to `rel`, a path inside `.visvet/`, changes the review: the threads, the reviewed marks, what the user has
/// explored and test coverage do; the hand-offs don't.
pub fn affects_review(rel: &Path) -> bool {
    is_annotation(rel) || rel == Path::new(NAME).join("coverage.lcov")
}

/// Whether `rel`, a path from the repository's top folder, is part of a comment thread, the reviewed marks, the importance
/// ratings, or what the user has explored.
pub fn is_annotation(rel: &Path) -> bool {
    let in_folder = |folder: &str| rel.starts_with(Path::new(NAME).join(folder));
    let is_file = |name: &str| rel == Path::new(NAME).join(name);
    in_folder("threads") || in_folder("explored") || is_file("reviewed") || is_file("importance")
}

//! Review state in `<repo_root>/.visvet/state.json`: the AI's notes and comment threads.
//! Also the hand-off files between the UI and the AI: `view.json` (what the user sees) and `show.json` (where the AI sends them).
use crate::types::{Author, MapId, MessageKind, ReviewAnnotations, Thread, ThreadId, ThreadMessage, ThreadState};
use anyhow::anyhow;
use anyhow::Result;
use serde::{Serialize, de::DeserializeOwned};
use std::{fs, io::ErrorKind, path::{Path, PathBuf}};

/// Reads the review state; a missing file is an empty state.
pub fn load(repo_root: &Path) -> Result<ReviewAnnotations> {
    Ok(get(repo_root, "state.json")?.unwrap_or_default())
}

/// Reads `.visvet/<name>` as JSON, or none if it doesn't exist.
pub fn get<T: DeserializeOwned>(repo_root: &Path, name: &str) -> Result<Option<T>> {
    match fs::read(repo_root.join(".visvet").join(name)) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Writes `value` to `.visvet/<name>` as one-line JSON, through a temporary file so readers never see half of it.
pub fn put(repo_root: &Path, name: &str, value: &impl Serialize) -> Result<()> {
    let tmp = dir(repo_root)?.join(format!("{name}.tmp"));
    fs::write(&tmp, serde_json::to_vec(value)?)?;
    Ok(fs::rename(tmp, repo_root.join(".visvet").join(name))?)
}

/// `.visvet/`, created on first use with a .gitignore that keeps it out of git.
fn dir(repo_root: &Path) -> Result<PathBuf> {
    let dir = repo_root.join(".visvet");
    fs::create_dir_all(&dir)?;
    if !dir.join(".gitignore").exists() {
        fs::write(dir.join(".gitignore"), "*\n")?;
    }
    Ok(dir)
}

/// Apply `f` to the state under an exclusive lock on `.visvet/`, then save it.
fn update<R>(repo_root: &Path, f: impl FnOnce(&mut ReviewAnnotations) -> Result<R>) -> Result<R> {
    let lock = fs::File::open(dir(repo_root)?)?;
    lock.lock()?;
    let mut state = load(repo_root)?;
    let r = f(&mut state)?;
    put(repo_root, "state.json", &state)?;
    Ok(r)
}

/// The id for a new thread: one more than the highest so far, so ids are never reused.
fn next_id(s: &ReviewAnnotations) -> ThreadId {
    ThreadId(s.threads.iter().map(|t| t.id.0).max().unwrap_or(0) + 1)
}

/// Saves the AI's note on box `target` as a note message in its latest thread, or in a new thread that needs no
/// answer (resolved). It replaces the box's earlier note, so each box has one current note.
pub fn add_note(repo_root: &Path, target: MapId, text: String) -> Result<()> {
    update(repo_root, |s| {
        for t in s.threads.iter_mut().filter(|t| t.target == target) {
            t.messages.retain(|m| m.kind != MessageKind::Note);
        }
        s.threads.retain(|t| !t.messages.is_empty());
        let note = ThreadMessage { author: Author::Ai, text, kind: MessageKind::Note };
        match s.threads.iter_mut().rfind(|t| t.target == target) {
            Some(t) => t.messages.push(note),
            None => s.threads.push(Thread { id: next_id(s), target, state: ThreadState::Resolved, messages: vec![note] }),
        }
        Ok(())
    })
}

/// Starts a comment thread from the user on `target`, waiting for the AI.
pub fn new_thread(repo_root: &Path, target: MapId, text: String) -> Result<()> {
    update(repo_root, |s| {
        let id = next_id(s);
        s.threads.push(Thread { id, target, state: ThreadState::Open, messages: vec![ThreadMessage { author: Author::User, text, kind: MessageKind::Reply }] });
        Ok(())
    })
}

/// Adds a message to thread `id` and moves it on: a user message (re)opens it for the AI; an AI message sets `state`.
pub fn reply(repo_root: &Path, id: ThreadId, author: Author, text: String, state: ThreadState) -> Result<()> {
    update(repo_root, |s| {
        let t = s.threads.iter_mut().find(|t| t.id == id).ok_or_else(|| anyhow!("no thread {id}"))?;
        t.messages.push(ThreadMessage { author, text, kind: MessageKind::Reply });
        // A user's message hands the thread back to the AI, unless it resolves it.
        t.state = if author == Author::User && state != ThreadState::Resolved { ThreadState::Open } else { state };
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn threads_move_between_user_and_ai() {
        let repo_root = std::env::temp_dir().join(format!("visvet-threads-{}", std::process::id()));
        fs::create_dir_all(&repo_root).unwrap();
        new_thread(&repo_root, MapId("src/a.rs".into()), "rename this".into()).unwrap();
        let state = |r: &Path| load(r).unwrap().threads[0].state;
        assert_eq!(state(&repo_root), ThreadState::Open);
        reply(&repo_root, ThreadId(1), Author::Ai, "which name?".into(), ThreadState::Question).unwrap();
        assert_eq!(state(&repo_root), ThreadState::Question);
        reply(&repo_root, ThreadId(1), Author::User, "call it b".into(), ThreadState::Open).unwrap();
        assert_eq!(state(&repo_root), ThreadState::Open); // a user message hands it back to the AI
        reply(&repo_root, ThreadId(1), Author::Ai, "renamed; tests too?".into(), ThreadState::Question).unwrap();
        reply(&repo_root, ThreadId(1), Author::User, "fine as is".into(), ThreadState::Resolved).unwrap(); // the user dismisses it
        assert_eq!((state(&repo_root), load(&repo_root).unwrap().threads[0].messages.len()), (ThreadState::Resolved, 5));
        fs::remove_dir_all(repo_root).unwrap();
    }

    #[test]
    fn a_note_joins_the_box_thread_and_replaces_the_last_one() {
        let repo_root = std::env::temp_dir().join(format!("visvet-notes-{}", std::process::id()));
        fs::create_dir_all(&repo_root).unwrap();
        let (a, b) = (MapId("src/a.rs".into()), MapId("src/b.rs".into()));
        add_note(&repo_root, a.clone(), "first".into()).unwrap();
        add_note(&repo_root, a.clone(), "second".into()).unwrap(); // replaces "first"
        new_thread(&repo_root, b.clone(), "why?".into()).unwrap();
        add_note(&repo_root, b, "because".into()).unwrap(); // joins the user's thread
        let s = load(&repo_root).unwrap();
        let texts: Vec<Vec<&str>> = s.threads.iter().map(|t| t.messages.iter().map(|m| m.text.as_str()).collect()).collect();
        assert_eq!(texts, [vec!["second"], vec!["why?", "because"]]);
        assert_eq!((s.threads[0].state, s.threads[1].state), (ThreadState::Resolved, ThreadState::Open));
        fs::remove_dir_all(repo_root).unwrap();
    }
}

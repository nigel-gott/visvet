//! Review state: the comment threads, one Markdown file per message in `.visvet/threads/<thread id>/`. They are
//! committed with the code, so pushing and pulling shares them, and anyone can read them without visvet.
//! Also the local hand-off files between the UI and the AI, kept out of git: `view.json` (what the user sees) and
//! `show.json` (where the AI sends them).
use crate::git;
use crate::visvet_dir::{HandOff, VisvetDir};
use crate::types::{Author, MapId, MessageKind, ReviewAnnotations, Thread, ThreadId, ThreadMessage, ThreadState};
use anyhow::{Context, Result, anyhow};
use serde::{Serialize, de::DeserializeOwned};
use std::hash::{BuildHasher, RandomState};
use std::time::{SystemTime, UNIX_EPOCH};
use std::{fs, io::ErrorKind, path::Path};

/// Reads every thread from `.visvet/threads/`, oldest first; a missing folder means none.
pub fn load(repo_root: &Path) -> Result<ReviewAnnotations> {
    let mut threads = vec![];
    let folders = match fs::read_dir(VisvetDir::of(repo_root).threads()) {
        Err(e) if e.kind() == ErrorKind::NotFound => return Ok(ReviewAnnotations::default()),
        r => r?,
    };
    for folder in folders {
        let folder = folder?.path();
        if !folder.is_dir() {
            continue;
        }
        let mut messages = vec![];
        for file in fs::read_dir(&folder)? {
            let file = file?.path();
            if file.extension().is_some_and(|e| e == "md") {
                messages.push(parse(&fs::read_to_string(&file)?).with_context(|| format!("reading {}", file.display()))?);
            }
        }
        messages.sort_by_key(|(_, m)| m.at);
        // The thread is about the box its first message names, and stands where its last message left it.
        let (Some((target, _)), Some((_, last))) = (messages.first(), messages.last()) else { continue };
        let (target, state, id) = (target.clone(), last.state, ThreadId(folder.file_name().unwrap().to_string_lossy().into()));
        threads.push(Thread { id, target, state, messages: messages.into_iter().map(|(_, m)| m).collect() });
    }
    threads.sort_by_key(|t| t.messages[0].at);
    Ok(ReviewAnnotations { threads })
}

/// Writes every message of `s` that is new or changed, and deletes the files of messages and threads it no longer has.
fn save(repo_root: &Path, s: &ReviewAnnotations) -> Result<()> {
    let root = VisvetDir::of(repo_root).threads();
    for t in &s.threads {
        let folder = root.join(&t.id.0);
        fs::create_dir_all(&folder)?;
        let mut keep = vec![];
        for m in &t.messages {
            let file = folder.join(file_name(m));
            let text = render(&t.target, m);
            if fs::read_to_string(&file).ok().as_deref() != Some(&text) {
                fs::write(&file, &text)?;
            }
            keep.push(file);
        }
        for old in fs::read_dir(&folder)? {
            let old = old?.path();
            if !keep.contains(&old) {
                fs::remove_file(old)?;
            }
        }
    }
    for folder in fs::read_dir(&root)? {
        let folder = folder?.path();
        if !s.threads.iter().any(|t| folder.ends_with(&t.id.0)) {
            fs::remove_dir_all(folder)?;
        }
    }
    Ok(())
}

/// A message's file name: its time, then its writer, e.g. "1761400000000-nigel-gott.md".
fn file_name(m: &ThreadMessage) -> String {
    let who: String = m.name.to_lowercase().chars().map(|c| if c.is_alphanumeric() { c } else { '-' }).collect();
    format!("{}-{who}.md", m.at)
}

/// A message as a Markdown file: a header of `key: value` lines between `---` lines, then the text.
fn render(target: &MapId, m: &ThreadMessage) -> String {
    format!("---\nbox: {target}\nauthor: {}\nname: {}\nkind: {}\nstate: {}\nat: {}\n---\n{}\n",
        word(&m.author), m.name, word(&m.kind), word(&m.state), m.at, m.text)
}

/// Reads a message file written by `render`: the box it is about, and the message.
fn parse(file: &str) -> Result<(MapId, ThreadMessage)> {
    let (head, text) = file.strip_prefix("---\n").and_then(|f| f.split_once("\n---\n")).ok_or_else(|| anyhow!("no --- header"))?;
    let field = |key: &str| head.lines().find_map(|l| l.strip_prefix(key)?.strip_prefix(": ")).ok_or_else(|| anyhow!("no {key}"));
    let m = ThreadMessage {
        author: unword(field("author")?)?,
        name: field("name")?.into(),
        text: text.strip_suffix('\n').unwrap_or(text).into(),
        kind: unword(field("kind")?)?,
        state: unword(field("state")?)?,
        at: field("at")?.parse()?,
    };
    Ok((MapId(field("box")?.into()), m))
}

/// An enum value as its JSON word, e.g. `ThreadState::Open` as "open".
fn word(v: &impl Serialize) -> String {
    serde_json::to_value(v).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default()
}

/// The enum value a JSON word names, e.g. "open" as `ThreadState::Open`.
fn unword<T: DeserializeOwned>(w: &str) -> Result<T> {
    Ok(serde_json::from_value(serde_json::Value::String(w.into()))?)
}

/// Reads hand-off `h` as JSON, or none if it doesn't exist.
pub fn get<T: DeserializeOwned>(repo_root: &Path, h: HandOff) -> Result<Option<T>> {
    match fs::read(VisvetDir::of(repo_root).hand_off(h)) {
        Ok(bytes) => Ok(Some(serde_json::from_slice(&bytes)?)),
        Err(e) if e.kind() == ErrorKind::NotFound => Ok(None),
        Err(e) => Err(e.into()),
    }
}

/// Writes `value` to hand-off `h` as one-line JSON, through a temporary file so readers never see half of it.
pub fn put(repo_root: &Path, h: HandOff, value: &impl Serialize) -> Result<()> {
    let dir = VisvetDir::of(repo_root);
    let (file, tmp) = (dir.hand_off(h), dir.create()?.join("hand-off.tmp"));
    fs::write(&tmp, serde_json::to_vec(value)?)?;
    Ok(fs::rename(tmp, file)?)
}

/// Apply `f` to the threads under an exclusive lock on `.visvet/`, then save them.
fn update<R>(repo_root: &Path, f: impl FnOnce(&mut ReviewAnnotations) -> Result<R>) -> Result<R> {
    let lock = fs::File::open(VisvetDir::of(repo_root).create()?)?;
    lock.lock()?;
    let mut state = load(repo_root)?;
    let r = f(&mut state)?;
    save(repo_root, &state)?;
    Ok(r)
}

/// A new thread's id: six random letters and digits.
fn new_id() -> ThreadId {
    let mut n = RandomState::new().hash_one(SystemTime::now());
    ThreadId((0..6).map(|_| { let c = char::from_digit((n % 36) as u32, 36).unwrap(); n /= 36; c }).collect())
}

/// A message by `author`, now: named after the person's git `user.name`, or "Claude".
fn message(repo_root: &Path, author: Author, text: String, kind: MessageKind, state: ThreadState) -> ThreadMessage {
    let name = match author {
        Author::Ai => "Claude".into(),
        Author::User => git::git(repo_root, &["config", "user.name"]).map(|o| String::from_utf8_lossy(&o).trim().to_string()).unwrap_or_default(),
    };
    let at = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64);
    ThreadMessage { author, name: if name.is_empty() { "you".into() } else { name }, text, kind, state, at }
}

/// Adds `m` to thread `t`, after its last message even if the clock says otherwise, and moves the thread to `m`'s state.
fn push(t: &mut Thread, mut m: ThreadMessage) {
    m.at = m.at.max(t.messages.last().map_or(0, |l| l.at + 1));
    t.state = m.state;
    t.messages.push(m);
}

/// Saves the AI's note on box `target` as a note message in its latest thread, or in a new thread that needs no
/// answer (resolved). It replaces the box's earlier note, so each box has one current note.
pub fn add_note(repo_root: &Path, target: MapId, text: String) -> Result<()> {
    update(repo_root, |s| {
        for t in s.threads.iter_mut().filter(|t| t.target == target) {
            t.messages.retain(|m| m.kind != MessageKind::Note);
        }
        s.threads.retain(|t| !t.messages.is_empty());
        let state = s.threads.iter().rfind(|t| t.target == target).map_or(ThreadState::Resolved, |t| t.state);
        let note = message(repo_root, Author::Ai, text, MessageKind::Note, state);
        match s.threads.iter_mut().rfind(|t| t.target == target) {
            Some(t) => push(t, note),
            None => s.threads.push(Thread { id: new_id(), target, state, messages: vec![note] }),
        }
        Ok(())
    })
}

/// Starts a comment thread from the user on `target`, waiting for the AI.
pub fn new_thread(repo_root: &Path, target: MapId, text: String) -> Result<()> {
    let m = message(repo_root, Author::User, text, MessageKind::Reply, ThreadState::Open);
    update(repo_root, |s| {
        s.threads.push(Thread { id: new_id(), target, state: ThreadState::Open, messages: vec![m] });
        Ok(())
    })
}

/// Adds a message to thread `id` and moves it on: a user message (re)opens it for the AI, unless it resolves it; an
/// AI message sets `state`.
pub fn reply(repo_root: &Path, id: ThreadId, author: Author, text: String, state: ThreadState) -> Result<()> {
    let state = if author == Author::User && state != ThreadState::Resolved { ThreadState::Open } else { state };
    let m = message(repo_root, author, text, MessageKind::Reply, state);
    update(repo_root, |s| {
        let t = s.threads.iter_mut().find(|t| t.id == id).ok_or_else(|| anyhow!("no thread {id}"))?;
        push(t, m);
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    /// An empty folder to stand in for a repository.
    fn repo(name: &str) -> PathBuf {
        let r = std::env::temp_dir().join(format!("visvet-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&r);
        fs::create_dir_all(&r).unwrap();
        r
    }

    #[test]
    fn threads_move_between_user_and_ai() {
        let r = repo("threads");
        new_thread(&r, MapId("src/a.rs".into()), "rename this".into()).unwrap();
        let id = load(&r).unwrap().threads[0].id.clone();
        let state = || load(&r).unwrap().threads[0].state;
        assert_eq!(state(), ThreadState::Open);
        reply(&r, id.clone(), Author::Ai, "which name?".into(), ThreadState::Question).unwrap();
        assert_eq!(state(), ThreadState::Question);
        reply(&r, id.clone(), Author::User, "call it b".into(), ThreadState::Open).unwrap();
        assert_eq!(state(), ThreadState::Open); // a user message hands it back to the AI
        reply(&r, id.clone(), Author::Ai, "renamed; tests too?\n\n- yes\n---\nno".into(), ThreadState::Question).unwrap();
        reply(&r, id.clone(), Author::User, "fine as is".into(), ThreadState::Resolved).unwrap(); // the user dismisses it
        let t = &load(&r).unwrap().threads[0];
        assert_eq!((t.state, t.messages.len(), t.target.as_str()), (ThreadState::Resolved, 5, "src/a.rs"));
        assert_eq!(t.messages[3].text, "renamed; tests too?\n\n- yes\n---\nno"); // text survives the file round trip
        assert_eq!(fs::read_dir(VisvetDir::of(&r).threads().join(&t.id.0)).unwrap().count(), 5); // one file per message
        fs::remove_dir_all(r).unwrap();
    }

    #[test]
    fn a_note_joins_the_box_thread_and_replaces_the_last_one() {
        let r = repo("notes");
        let (a, b) = (MapId("src/a.rs".into()), MapId("src/b.rs".into()));
        add_note(&r, a.clone(), "first".into()).unwrap();
        add_note(&r, a.clone(), "second".into()).unwrap(); // replaces "first"
        new_thread(&r, b.clone(), "why?".into()).unwrap();
        add_note(&r, b, "because".into()).unwrap(); // joins the user's thread
        let s = load(&r).unwrap();
        let texts: Vec<Vec<&str>> = s.threads.iter().map(|t| t.messages.iter().map(|m| m.text.as_str()).collect()).collect();
        assert_eq!(texts, [vec!["second"], vec!["why?", "because"]]);
        assert_eq!((s.threads[0].state, s.threads[1].state), (ThreadState::Resolved, ThreadState::Open));
        fs::remove_dir_all(r).unwrap();
    }
}

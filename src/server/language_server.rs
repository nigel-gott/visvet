//! Asks a language server what a name in code is, and where it is defined: the program editors use for "go to definition", which
//! knows the type of every value, so also what a method call like `form.tail()` means. Only Rust so far, through
//! `rust-analyzer`. It is started the first time a name is asked about and kept running; it reads the project by
//! itself, which takes a while, and until then it has no answers. Messages go over its standard input and output as
//! the Language Server Protocol says: a `Content-Length` header, a blank line, then JSON.
use crate::types::{NameMeaning, PlaceInCode, RepoPath};
use anyhow::{Context, Result, anyhow, bail};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Mutex, mpsc::{self, Receiver}};
use std::time::Duration;
use url::Url;

/// The program that answers for Rust code.
const RUST_LANGUAGE_SERVER: &str = "rust-analyzer";
/// How long the language server gets to say hello after it starts.
const STARTS_WITHIN: Duration = Duration::from_secs(30);
/// How long a question waits for its answer; a later one is dropped. While the server still reads the project it
/// may not answer at all.
const ANSWERS_WITHIN: Duration = Duration::from_secs(3);

/// A name in the code of `file` as it is now: the line it is on (the first is 1) and a column inside the name (the
/// first is 0, counted as JavaScript counts a string's characters, which is how the protocol counts too).
#[derive(Deserialize)]
pub struct NameInCode { pub file: RepoPath, pub line: u32, pub column: u32 }

/// The language server of one repository: not running until first asked.
pub struct LanguageServer { repo_root: PathBuf, running: Mutex<Option<Running>> }

/// A started language server: its process, the pipe to it, its answers as a reader thread hands them over, and how
/// many questions it was sent (each question's number is its id).
struct Running { process: Child, to_server: ChildStdin, answers: Receiver<Value>, questions_sent: u64 }

/// Sends one message to the language server.
fn send(to_server: &mut ChildStdin, message: &Value) -> Result<()> {
    let body = serde_json::to_vec(message)?;
    write!(to_server, "Content-Length: {}\r\n\r\n", body.len())?;
    to_server.write_all(&body)?;
    Ok(to_server.flush()?)
}

/// Reads the next message of the language server: header lines up to a blank one, then a body as long as they say.
fn next_message(from_server: &mut impl BufRead) -> Result<Value> {
    let mut body_length = 0;
    loop {
        let mut header = String::new();
        if from_server.read_line(&mut header)? == 0 {
            bail!("the language server stopped");
        }
        let Some((name, value)) = header.trim_end().split_once(": ") else { break };
        if name.eq_ignore_ascii_case("Content-Length") {
            body_length = value.parse()?;
        }
    }
    let mut body = vec![0; body_length];
    from_server.read_exact(&mut body)?;
    Ok(serde_json::from_slice(&body)?)
}

impl Running {
    /// Starts the language server on the project in `repo_root` and greets it.
    fn start(repo_root: &Path) -> Result<Running> {
        let mut process = Command::new(RUST_LANGUAGE_SERVER).current_dir(repo_root)
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null()).spawn()
            .with_context(|| format!("starting {RUST_LANGUAGE_SERVER}; install it with `rustup component add rust-analyzer`"))?;
        let to_server = process.stdin.take().context("no pipe to the language server")?;
        let mut from_server = BufReader::new(process.stdout.take().context("no pipe from the language server")?);
        let (hand_over, answers) = mpsc::channel();
        // Everything the server says is read as it comes, so it never waits on a full pipe; only answers are kept,
        // not its own notices and questions (a message with a `method`).
        std::thread::spawn(move || {
            while let Ok(message) = next_message(&mut from_server) {
                let is_answer = message.get("method").is_none();
                if is_answer && hand_over.send(message).is_err() {
                    break;
                }
            }
        });
        let mut running = Running { process, to_server, answers, questions_sent: 0 };
        let project = Url::from_directory_path(repo_root).map_err(|()| anyhow!("{} is no full path", repo_root.display()))?;
        // It must not run `cargo check` each time a file is saved: that would hold up the user's own builds.
        let hello = json!({ "processId": std::process::id(), "rootUri": project.as_str(),          "capabilities": { "textDocument": { "hover": { "contentFormat": ["markdown"] } } }, "initializationOptions": { "checkOnSave": false } });
        running.ask("initialize", hello, STARTS_WITHIN)?;
        send(&mut running.to_server, &json!({ "jsonrpc": "2.0", "method": "initialized", "params": {} }))?;
        Ok(running)
    }

    /// Asks the language server one question and waits for its answer; an answer that says "error" comes back empty.
    fn ask(&mut self, method: &str, params: Value, within: Duration) -> Result<Value> {
        self.questions_sent += 1;
        let id = self.questions_sent;
        send(&mut self.to_server, &json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }))?;
        loop {
            let answer = self.answers.recv_timeout(within)?;
            // The answer to an earlier question, come too late, is dropped.
            if answer["id"] == id {
                return Ok(answer["result"].clone());
            }
        }
    }
}

impl LanguageServer {
    /// The language server for the project in `repo_root`, started only when first asked.
    pub fn of(repo_root: &Path) -> Self {
        LanguageServer { repo_root: repo_root.into(), running: Mutex::new(None) }
    }

    /// What `name` is: where this repository's files define it, or else (a name of the standard library or a
    /// dependency) what the server shows an editor's user who hovers it. Nothing for a file that isn't Rust, and
    /// while the server has no answer yet.
    pub fn meaning_of(&self, name: &NameInCode) -> Result<NameMeaning> {
        if !name.file.is_rust() || name.line == 0 {
            return Ok(NameMeaning::default());
        }
        let mut running = self.running.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        let server = match &mut *running {
            Some(server) => server,
            not_running => not_running.insert(Running::start(&self.repo_root)?),
        };
        let file = Url::from_file_path(self.repo_root.join(&name.file.0)).map_err(|()| anyhow!("{} is no full path", name.file))?;
        let asked = json!({ "textDocument": { "uri": file.as_str() }, "position": { "line": name.line - 1, "character": name.column } });
        let answers = server.ask("textDocument/definition", asked.clone(), ANSWERS_WITHIN).and_then(|defined| {
            let places = self.places_in_repo(defined);
            let hovered = if places.is_empty() { server.ask("textDocument/hover", asked, ANSWERS_WITHIN)? } else { Value::Null };
            let library_docs = hovered.pointer("/contents/value").and_then(Value::as_str).map(String::from);
            Ok(NameMeaning { places, library_docs })
        });
        // A server that stopped is started again at the next question.
        if answers.is_err() && !matches!(server.process.try_wait(), Ok(None)) {
            *running = None;
        }
        answers
    }

    /// The places of the server's answer to "where is it defined" that are files of this repository. The answer is
    /// one place, a list of places, or nothing.
    fn places_in_repo(&self, defined: Value) -> Vec<PlaceInCode> {
        let places = match defined { Value::Array(places) => places, Value::Null => vec![], place => vec![place] };
        places.iter().filter_map(|place| {
            let file = Url::parse(place["uri"].as_str()?).ok()?.to_file_path().ok()?;
            let line = place.pointer("/range/start/line")?.as_u64()? as u32 + 1;
            Some(PlaceInCode { file: RepoPath(file.strip_prefix(&self.repo_root).ok()?.into()), line })
        }).collect()
    }
}

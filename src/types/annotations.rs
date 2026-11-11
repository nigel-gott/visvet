//! The review work saved in `.visvet/`: the comment threads between people and the AI, which also hold the AI's notes,
//! and the files the user marked as reviewed.
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use super::{MapId, RepoPath};

/// Whether a person or the AI wrote a message in a comment thread.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum Author { User, Ai }

/// Where a comment thread stands.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum ThreadState {
    /// Waiting for the AI: new, or the user replied.
    Open,
    /// The AI has picked it up.
    Working,
    /// The AI asked something and is waiting for the user.
    Question,
    /// Done; a user reply reopens it.
    Resolved,
}

/// What a message in a thread is.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, Default, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum MessageKind {
    /// Part of the conversation.
    #[default]
    Reply,
    /// The AI's review note on the box (`visvet explain`): why it changed, what to check, or a risk. It needs no answer.
    Note,
}

/// One message in a comment thread, saved as one file so two people replying at once never clash in git.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct ThreadMessage {
    pub author: Author,
    /// Who wrote it: a person's git `user.name`, or "Claude".
    pub name: String,
    pub text: String,
    pub kind: MessageKind,
    /// The thread's state once this message was added; the last message's is the thread's.
    pub state: ThreadState,
    /// When it was written, in milliseconds since 1970; messages are in this order.
    #[ts(type = "number")]
    pub at: u64,
}

/// A thread's id, e.g. "k3f9a2" for "#k3f9a2": random, so people starting threads on different machines never pick
/// the same one. It is also the name of the thread's folder.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct ThreadId(pub String);

impl std::fmt::Display for ThreadId {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { write!(f, "#{}", self.0) }
}

/// A conversation between the user and the AI about one box, folder or arrow.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Thread { pub id: ThreadId, pub target: MapId, pub state: ThreadState, pub messages: Vec<ThreadMessage> }

/// Where a file the user marked as reviewed stands now.
#[derive(Serialize, Deserialize, Clone, Copy, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(rename_all = "lowercase")]
pub enum ReviewedState {
    /// Its content is what the user reviewed.
    Reviewed,
    /// It changed after the user reviewed it, so it needs another look.
    Changed,
}

/// A file the user marked as reviewed, and whether it changed since. A file with no mark is not listed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct ReviewedFile { pub file: RepoPath, pub state: ReviewedState }

/// A file the user has explored some of: how many of its lines, as it is now, they have had on screen while active.
/// A file they have seen nothing of is not listed.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct ExploredFile { pub file: RepoPath, pub seen_lines: usize }

/// The review work that can't be rebuilt from code: the comment threads, kept in `.visvet/threads/`, the files
/// marked as reviewed, kept in `.visvet/reviewed`, and what the user has explored, kept in `.visvet/explored/`.
#[derive(Serialize, Deserialize, Clone, Debug, Default, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct ReviewAnnotations {
    pub threads: Vec<Thread>,
    /// Filled by the server (see `state::reviewed`); the thread store leaves it empty.
    pub reviewed: Vec<ReviewedFile>,
    /// Filled by the server (see `state::explored`); the thread store leaves it empty.
    pub explored: Vec<ExploredFile>,
}

//! The review work saved in `.visvet/state.json`: the AI's notes and the comment threads between the user and the AI.
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use super::MapId;

/// The AI's review note on a box, folder or arrow (`visvet explain`).
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct AiNote { pub target: MapId, pub why: String }

/// Who wrote a message in a comment thread.
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

/// One message in a comment thread.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct ThreadMessage { pub author: Author, pub text: String }

/// A conversation between the user and the AI about one box, folder or arrow.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Thread { pub id: u32, pub target: MapId, pub state: ThreadState, pub messages: Vec<ThreadMessage> }

/// The review work that can't be rebuilt from code, kept in `.visvet/state.json`: the AI's notes and comment threads.
/// Missing fields load as empty, and unknown ones are ignored, so old files still load.
#[derive(Serialize, Deserialize, Clone, Debug, Default, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
#[serde(default)]
pub struct ReviewAnnotations {
    pub notes: Vec<AiNote>,
    pub threads: Vec<Thread>,
}

//! The hand-offs between the UI and the AI: what the user is looking at, and where the AI sends them.
use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Anything on the map the user can select or zoom into: a box id (see `BoxId`), a folder ending in "/"
/// (e.g. "src/types/"), or an arrow "<from> -> <to>".
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq, Eq, Hash, PartialOrd, Ord, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct MapId(pub String);

string_methods!(MapId);

/// What the user is looking at in the UI. The UI posts it on every change; `visvet view` prints it.
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct View {
    /// The box or folder the map is zoomed into, or none for the whole map.
    pub scope: Option<MapId>,
    /// How many levels deep the unzoomed map shows boxes, counting from 0 (only the top folders and files).
    pub level: u32,
    /// What the user clicked last, if anything.
    pub selected: Option<MapId>,
    /// Boxes and arrows highlighted by `visvet show`.
    pub highlight: Vec<MapId>,
    /// The boxes on screen.
    pub visible: Vec<MapId>,
}

/// The AI asks the UI to open `target` and highlight these boxes and arrows (`visvet show`).
#[derive(Serialize, Deserialize, Clone, Debug, TS)]
#[ts(export, export_to = "../ui/src/contract.ts")]
pub struct Show { pub target: MapId, pub highlight: Vec<MapId> }

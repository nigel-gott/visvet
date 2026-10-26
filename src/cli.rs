//! The command line: `visvet serve` (the default) runs the review UI; the other commands are for agents: notes,
//! comment threads, what the user sees, the map as text, and test coverage.
mod graph;
mod threads;
mod view;

use crate::review::coverage;
use crate::state::store;
use crate::state::visvet_dir::HandOff;
use crate::types::{Author, MapId, Show, ThreadId, ThreadState};
use crate::{git, server};
use clap::{Args, Parser, Subcommand};
use std::path::PathBuf;

/// Review AI coding changes one level above the code.
#[derive(Parser)]
struct Cli {
    /// The git repository to review: its folder, or any folder inside it
    #[arg(long, global = true, default_value = ".")]
    repo: PathBuf,
    #[command(subcommand)]
    cmd: Option<Cmd>,
    #[command(flatten)]
    serve: ServeArgs,
}

/// Options for serving the review UI.
#[derive(Args)]
struct ServeArgs {
    /// Git ref to diff the working tree against
    #[arg(long, default_value = "HEAD")]
    base: String,
    /// Don't open a browser
    #[arg(long)]
    no_open: bool,
    #[command(flatten)]
    addr: server::Addr,
}

/// What to run; with no subcommand, visvet serves.
#[derive(Subcommand)]
enum Cmd {
    /// Run the review UI (default)
    Serve(ServeArgs),
    /// Attach a review note to a box or arrow
    Explain {
        /// Box, member or file id, a folder ending in "/", or a dependency arrow "<from> -> <to>"
        symbol: String,
        #[arg(required = true)]
        why: Vec<String>,
    },
    /// Print the map's coupling, cycles, zoom views and complexity, worst first
    Graph {
        /// Git ref to diff the working tree against
        #[arg(long, default_value = "HEAD")]
        base: String,
    },
    /// Run the Rust tests under cargo llvm-cov, so boxes show a low-coverage debuff
    Coverage,
    /// Print the user's comment threads waiting for you; --all adds working and question ones
    Threads {
        #[arg(long)]
        all: bool,
        /// Run as the Claude Code stop hook: keep working while threads are open
        #[arg(long)]
        stop_hook: bool,
    },
    /// Answer a comment thread; it stays working unless --resolve or --ask
    Reply {
        #[arg(value_parser = |s: &str| Ok::<_, String>(ThreadId(s.trim_start_matches('#').into())))]
        id: ThreadId,
        #[arg(required = true)]
        text: Vec<String>,
        /// The thread is done
        #[arg(long)]
        resolve: bool,
        /// You asked the user something and need an answer
        #[arg(long, conflicts_with = "resolve")]
        ask: bool,
    },
    /// Wait until the user leaves a comment, then print it (run in the background while idle)
    Wait,
    /// Print what the user is looking at in the UI
    View,
    /// Open a symbol in the UI and highlight boxes and arrows
    Show {
        /// The symbol to open, in any form `explain` takes
        symbol: String,
        /// Box ids or "<from> -> <to>" arrows to highlight as well
        #[arg(long, num_args = 1..)]
        highlight: Vec<String>,
    },
}

/// Reads the command line, finds the repository's top folder, then runs the chosen command.
pub async fn run() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let top = git::git(&cli.repo, &["rev-parse", "--show-toplevel"])?;
    let repo_root = PathBuf::from(String::from_utf8(top)?.trim()).canonicalize()?;
    match cli.cmd.unwrap_or(Cmd::Serve(cli.serve)) {
        Cmd::Serve(s) => server::serve(repo_root, s.base, s.addr, !s.no_open).await,
        Cmd::Explain { symbol, why } => store::add_note(&repo_root, MapId(symbol), why.join(" ")),
        Cmd::Graph { base } => graph::print(&repo_root, &base),
        Cmd::View => view::print(&repo_root),
        Cmd::Coverage => coverage::run(&repo_root),
        Cmd::Threads { stop_hook: true, .. } => threads::stop_hook(&repo_root),
        Cmd::Threads { all, .. } => threads::print(&repo_root, all),
        Cmd::Reply { id, text, resolve, ask } => {
            let state = if resolve { ThreadState::Resolved } else if ask { ThreadState::Question } else { ThreadState::Working };
            store::reply(&repo_root, id, Author::Ai, text.join(" "), state)
        }
        Cmd::Wait => threads::wait(&repo_root),
        Cmd::Show { symbol, highlight } => store::put(&repo_root, HandOff::Show, &Show { target: MapId(symbol), highlight: highlight.into_iter().map(MapId).collect() }),
    }
}

//! The visvet CLI: serves the review UI, and gives agents the explain, graph, view, show, coverage and comment-thread commands.
mod coverage;
mod extract;
mod git;
mod graph;
mod model;
mod server;
mod store;
mod threads;
mod types;

use clap::{Args, Parser, Subcommand};
use std::path::{Path, PathBuf};
use types::{Author, MapId, Show, ThreadState, View};

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
        /// Unit, member or file id, a folder ending in "/", or a dependency arrow "<from> -> <to>"
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
        id: u32,
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

/// Resolves the repository repo_root, then runs the chosen command.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    let top = git::git(&cli.repo, &["rev-parse", "--show-toplevel"])?;
    let repo_root = PathBuf::from(String::from_utf8(top)?.trim()).canonicalize()?;
    match cli.cmd.unwrap_or(Cmd::Serve(cli.serve)) {
        Cmd::Serve(s) => server::serve(repo_root, s.base, s.addr, !s.no_open).await,
        Cmd::Explain { symbol, why } => store::add_note(&repo_root, MapId(symbol), why.join(" ")),
        Cmd::Graph { base } => graph::print(&repo_root, &base),
        Cmd::View => view(&repo_root),
        Cmd::Coverage => coverage::run(&repo_root),
        Cmd::Threads { stop_hook: true, .. } => threads::stop_hook(&repo_root),
        Cmd::Threads { all, .. } => threads::print(&repo_root, all),
        Cmd::Reply { id, text, resolve, ask } => {
            let state = if resolve { ThreadState::Resolved } else if ask { ThreadState::Question } else { ThreadState::Working };
            store::reply(&repo_root, id, Author::Ai, text.join(" "), state)
        }
        Cmd::Wait => threads::wait(&repo_root),
        Cmd::Show { symbol, highlight } => store::put(&repo_root, "show.json", &Show { target: MapId(symbol), highlight: highlight.into_iter().map(MapId).collect() }),
    }
}

/// Prints what the user is looking at, and how long ago it last changed.
fn view(repo_root: &Path) -> anyhow::Result<()> {
    let Some(v) = store::get::<View>(repo_root, "view.json")? else {
        println!("visvet view: unknown, the UI has not been opened");
        return Ok(());
    };
    let age = std::fs::metadata(repo_root.join(".visvet/view.json"))?.modified()?.elapsed().unwrap_or_default().as_secs();
    let scope = v.scope.map_or(format!("whole map, {} levels deep", v.level + 1), |s| format!("zoomed into {s}"));
    println!("visvet view ({age}s ago): {scope}");
    let lines = [("selected", v.selected.into_iter().collect()), ("highlighted", v.highlight), ("on screen", v.visible)];
    for (label, ids) in lines.into_iter().filter(|(_, ids)| !ids.is_empty()) {
        println!("  {label}: {}", ids.iter().map(|i| i.as_str()).collect::<Vec<_>>().join(", "));
    }
    Ok(())
}


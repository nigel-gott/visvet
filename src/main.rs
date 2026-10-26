//! visvet: a multi-lens, visual way to review code changes. `cli` reads the command; the rest is what it runs.
mod cli;
mod git;
mod review;
mod server;
mod state;
mod types;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    cli::run().await
}

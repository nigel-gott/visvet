//! HTTP API, change and show events and the embedded UI, answering only to known host names.
use crate::{coverage, model::build_review, store, types::{Author, MapId, Review, ThreadId, ThreadState, View}};
use axum::{
    Json, Router,
    extract::{Path as UrlPath, Request, State},
    http::{StatusCode, Uri, header},
    middleware::{self, Next},
    response::{IntoResponse, Response, sse::{Event, Sse}},
    routing::{get, post},
};
use notify::{RecursiveMode, Watcher};
use serde::Deserialize;
use std::{convert::Infallible, fmt::Display};
use std::{path::{Path, PathBuf}, sync::mpsc, time::Duration};
use tokio::sync::broadcast;
use tokio_stream::{Stream, StreamExt, wrappers::BroadcastStream};

/// The built UI (`ui/dist`); read from disk in debug builds, embedded in release builds.
#[derive(rust_embed::RustEmbed)]
#[folder = "ui/dist/"]
#[allow_missing = true]
struct Ui;

/// Where the server listens, and the public URL it is reached by behind a proxy.
#[derive(clap::Args)]
pub struct Addr {
    /// Address to listen on (0.0.0.0 = all interfaces)
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,
    /// Port to listen on
    #[arg(long, default_value_t = 7878)]
    pub port: u16,
    /// Public URL behind a proxy, e.g. https://mac.tailnet.ts.net; its host name is also accepted
    #[arg(long)]
    pub url: Option<String>,
}

/// Shared server state: the repo, the diff base, events for the UI and the host names it answers to.
#[derive(Clone)]
struct App { repo_root: PathBuf, base: String, tx: broadcast::Sender<Push>, hosts: Vec<String> }

/// An event pushed to the UI: files changed, so reload; or `visvet show` asked to navigate, with its JSON.
#[derive(Clone)]
enum Push { Change, Show(String) }

/// A handler result whose error is a 500 with a message.
type Res<T> = Result<T, (StatusCode, String)>;

/// Turns any error into a 500 response with its full cause chain.
fn err(e: impl Display) -> (StatusCode, String) {
    (StatusCode::INTERNAL_SERVER_ERROR, format!("{e:#}"))
}

/// Serves the API and UI to the allowed host names, prints the URL and opens the browser.
pub async fn serve(repo_root: PathBuf, base: String, addr: Addr, open_browser: bool) -> anyhow::Result<()> {
    let local = format!("http://{}:{}", if addr.host == "0.0.0.0" { "127.0.0.1" } else { &addr.host }, addr.port);
    let mut hosts: Vec<String> = [addr.host.as_str(), "127.0.0.1", "localhost"].iter().map(|h| format!("{h}:{}", addr.port)).collect();
    hosts.extend(addr.url.as_deref().and_then(|u| u.split("://").nth(1)?.split('/').next()).map(String::from));
    let (tx, _) = broadcast::channel(16);
    let _watcher = watch(repo_root.clone(), tx.clone())?;
    let app = App { repo_root, base, tx, hosts };
    let router = Router::new()
        .route("/api/model", get(model))
        .route("/api/events", get(events))
        .route("/api/view", post(set_view))
        .route("/api/threads", post(new_thread))
        .route("/api/threads/{id}", post(reply))
        .fallback(static_file)
        .layer(middleware::from_fn_with_state(app.clone(), check_host))
        .with_state(app);
    let listener = tokio::net::TcpListener::bind((addr.host.as_str(), addr.port)).await?;
    println!("{}", addr.url.as_deref().unwrap_or(&local));
    if open_browser {
        let _ = open::that(&local);
    }
    Ok(axum::serve(listener, router).await?)
}

/// Answers only requests addressed to an allowed host name, so a web page can't read
/// visvet through DNS rebinding. Cross-site POSTs already fail: the API takes only JSON.
async fn check_host(State(app): State<App>, req: Request, next: Next) -> Response {
    let host = req.headers().get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("").to_string();
    if !app.hosts.iter().any(|h| h.eq_ignore_ascii_case(&host)) {
        return (StatusCode::FORBIDDEN, format!("visvet: unknown host {host:?}; use 127.0.0.1 or the --url address")).into_response();
    }
    next.run(req).await
}

/// Per burst of file events (150ms apart at most): a `Show` if `visvet show` wrote `.visvet/show.json`,
/// and a `Change` if any other relevant file changed.
fn watch(repo_root: PathBuf, tx: broadcast::Sender<Push>) -> notify::Result<notify::RecommendedWatcher> {
    let (raw_tx, raw_rx) = mpsc::channel();
    let mut watcher = notify::recommended_watcher(raw_tx)?;
    watcher.watch(&repo_root, RecursiveMode::Recursive)?;
    let show = repo_root.join(".visvet/show.json");
    std::thread::spawn(move || {
        while let Ok(first) = raw_rx.recv() {
            let mut burst = vec![first];
            while let Ok(ev) = raw_rx.recv_timeout(Duration::from_millis(150)) {
                burst.push(ev);
            }
            let paths: Vec<PathBuf> = burst.into_iter().flatten().filter(|ev| !ev.kind.is_access()).flat_map(|ev| ev.paths).collect();
            if paths.contains(&show) && let Ok(json) = std::fs::read_to_string(&show) {
                let _ = tx.send(Push::Show(json));
            }
            if paths.iter().any(|p| relevant(&repo_root, p)) {
                let _ = tx.send(Push::Change);
            }
        }
    });
    Ok(watcher)
}

/// Inside `.git`, only HEAD and ref moves count, so commits and checkouts refresh.
/// Inside `.visvet`, only the review state and test coverage count, not the view and show hand-offs.
fn relevant(repo_root: &Path, path: &Path) -> bool {
    let rel = path.strip_prefix(repo_root).unwrap_or(path);
    if let Ok(own) = rel.strip_prefix(".visvet") {
        return own == Path::new("state.json") || own == Path::new("coverage.lcov");
    }
    if let Ok(git) = rel.strip_prefix(".git") {
        return ["HEAD", "packed-refs", "refs"].iter().any(|p| git.starts_with(p));
    }
    !rel.components().any(|c| matches!(c.as_os_str().to_str(), Some(".git" | "target" | "node_modules")))
}

/// Builds the review for the working tree and adds the stored review state.
async fn model(State(app): State<App>) -> Res<Json<Review>> {
    let m = tokio::task::spawn_blocking(move || -> anyhow::Result<Review> {
        let mut m = build_review(&app.repo_root, &app.base)?;
        m.annotations = store::load(&app.repo_root)?;
        coverage::add(&app.repo_root, &mut m);
        Ok(m)
    });
    m.await.map_err(err)?.map(Json).map_err(err)
}

/// Server-sent events: `change` on connect and per burst of file changes; `show` with the JSON `visvet show` wrote.
async fn events(State(app): State<App>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let pushes = tokio_stream::once(Ok(Push::Change)).chain(BroadcastStream::new(app.tx.subscribe()));
    Sse::new(pushes.map(|p| Ok(match p {
        Ok(Push::Show(json)) => Event::default().event("show").data(json),
        _ => Event::default().event("change").data("change"),
    })))
}

/// Body of POST /api/threads: a new comment thread from the user.
#[derive(Deserialize)]
struct NewThread { target: MapId, text: String }

/// Starts a comment thread from the user.
async fn new_thread(State(app): State<App>, Json(t): Json<NewThread>) -> Res<()> {
    store::new_thread(&app.repo_root, t.target, t.text).map_err(err)
}

/// Body of POST /api/threads/{id}: the user's reply, and whether it closes the thread (the user dismissing a question).
#[derive(Deserialize)]
struct Reply { text: String, #[serde(default)] resolve: bool }

/// Adds the user's reply to a thread, reopening it for the AI unless the reply resolves it.
async fn reply(State(app): State<App>, UrlPath(id): UrlPath<ThreadId>, Json(r): Json<Reply>) -> Res<()> {
    let state = if r.resolve { ThreadState::Resolved } else { ThreadState::Open };
    store::reply(&app.repo_root, id, Author::User, r.text, state).map_err(err)
}

/// Saves what the user is looking at, for `visvet view`.
async fn set_view(State(app): State<App>, Json(v): Json<View>) -> Res<()> {
    store::put(&app.repo_root, "view.json", &v).map_err(err)
}

/// Serves a UI file, falling back to index.html so client routes load the app.
async fn static_file(uri: Uri) -> Response {
    let mut path = uri.path().trim_start_matches('/');
    if Ui::get(path).is_none() {
        path = "index.html";
    }
    // Vite hashes asset names, so they never change; index.html must always be revalidated.
    let cache = if path.starts_with("assets/") { "public, max-age=31536000, immutable" } else { "no-cache" };
    match Ui::get(path) {
        Some(f) => {
            let mime = mime_guess::from_path(path).first_or_octet_stream().to_string();
            ([(header::CONTENT_TYPE, mime), (header::CACHE_CONTROL, cache.into())], f.data).into_response()
        }
        None => "UI not built: run `npm install && npm run build` in ui/".into_response(),
    }
}

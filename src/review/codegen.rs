//! Code generators: "generates" arrows from a type to the code a library writes from it, and from a package
//! manifest to its lock file, which parsing alone can't see. To support another generator, write a detector like
//! `ts_rs` and add it to `DETECTORS`, or add a manifest to `LOCK_FILES`.
use crate::review::parse::join;

/// Given a type's file and its source text (attributes included), the repo file a code generator writes a type of
/// the same name into, if it does.
type Detector = fn(file: &str, text: &str) -> Option<String>;

/// Every code generator visvet knows.
const DETECTORS: &[Detector] = &[ts_rs];

/// The repo files that type `text`, in `file`, is generated into.
pub fn targets(file: &str, text: &str) -> Vec<String> {
    DETECTORS.iter().filter_map(|d| d(file, text)).collect()
}

/// Each package manifest's file name, and the lock files its package managers write beside it.
const LOCK_FILES: &[(&str, &[&str])] = &[
    ("Cargo.toml", &["Cargo.lock"]),
    ("package.json", &["package-lock.json", "yarn.lock", "pnpm-lock.yaml"]),
    ("pyproject.toml", &["uv.lock", "poetry.lock"]),
    ("go.mod", &["go.sum"]),
    ("Gemfile", &["Gemfile.lock"]),
];

/// The lock files a package manager may write from manifest `file`, in its folder. The caller keeps those that exist.
pub fn lock_files(file: &str) -> Vec<String> {
    let (dir, name) = file.rsplit_once('/').unwrap_or(("", file));
    LOCK_FILES.iter().filter(|(manifest, _)| *manifest == name).flat_map(|(_, locks)| locks.iter())
        .map(|lock| join(dir, lock).to_string()).collect()
}

/// ts-rs: `#[ts(export, export_to = "../ui/src/contract.ts")]` on a Rust type writes a TypeScript copy of it to
/// that path, taken from the crate's `bindings/` folder (ts-rs's default export folder).
fn ts_rs(file: &str, text: &str) -> Option<String> {
    let attr = text.split("#[ts(").nth(1)?.split(")]").next()?;
    let to = attr.split("export_to = \"").nth(1)?.split('"').next()?;
    let krate = &file[..file.rfind("src/")?];
    Some(join(format!("{krate}bindings"), to).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ts_rs_export_points_at_the_ts_file() {
        let text = "#[derive(TS)]\n#[ts(export, export_to = \"../ui/src/contract.ts\")]\npub struct Thread {}";
        assert_eq!(targets("src/types/annotations.rs", text), ["ui/src/contract.ts"]);
        assert!(targets("src/a.rs", "pub struct Plain {}").is_empty());
    }

    #[test]
    fn manifest_points_at_its_lock_files() {
        assert_eq!(lock_files("Cargo.toml"), ["Cargo.lock"]);
        assert_eq!(lock_files("ui/package.json"), ["ui/package-lock.json", "ui/yarn.lock", "ui/pnpm-lock.yaml"]);
        assert!(lock_files("src/main.rs").is_empty());
    }
}

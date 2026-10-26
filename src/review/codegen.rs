//! Code generators: "generates" arrows from a type to the code a library writes from it, which parsing alone
//! can't see. To support another generator, write a detector like `ts_rs` and add it to `DETECTORS`.
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
}

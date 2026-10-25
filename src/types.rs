//! JSON contract shared by the extractor, the server, the CLI and the UI, one file per job.
//! `Serialize`/`Deserialize` come from serde, Rust's standard JSON library: they let each type convert to and from JSON.
//! `cargo test` regenerates the UI's copy, ui/src/contract.ts, from these types with ts-rs.

/// Gives micro types `.as_str()` and printing. A micro type is a one-field string wrapper with one meaning, such as
/// `UnitId`, that Rust won't let you mix up with other strings; in JSON and in the UI it is a plain string.
/// Each is declared as a plain struct, so visvet's map can see it; only these two helpers are generated.
macro_rules! string_methods {
    ($($name:ident),*) => {$(
        impl $name {
            #[allow(dead_code)] // not every micro type is read as a string yet
            pub fn as_str(&self) -> &str { &self.0 }
        }
        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result { f.write_str(&self.0) }
        }
    )*};
}

mod annotations;
mod boxes;
mod changes;
mod dependencies;
mod docs;
mod handoff;
mod ids;
mod review;
pub use annotations::*;
pub use boxes::*;
pub use changes::*;
pub use dependencies::*;
pub use docs::*;
pub use handoff::*;
pub use ids::*;
pub use review::*;

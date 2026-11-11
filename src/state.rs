//! visvet's own state in the repository: the comment threads and the reviewed marks (shared through git), the AI's importance ratings, what the user has explored (local) and the
//! folder they live in.
pub mod explored;
pub mod importance;
pub mod reviewed;
pub mod store;
pub mod visvet_dir;

//! The vault is a plain folder the user owns. Notes are `.md` / `.txt` files
//! (any folder structure, Obsidian-compatible `[[wiki links]]`), spreadsheets
//! live in `Sheets/*.vxsheet` (JSON), and exports go to `Exports/`.
//! Deleted files are moved to `.trash/` instead of being removed.

use std::fs;
use std::path::{Component, Path, PathBuf};

use serde::Serialize;
use tauri::State;
use walkdir::WalkDir;

use crate::{AppState, StrErr};

/// Resolve a vault-relative path, refusing anything that escapes the vault.
fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel_path = Path::new(rel);
    if rel_path.is_absolute()
        || rel_path
            .components()
            .any(|c| matches!(c, Component::ParentDir | Component::Prefix(_) | Component::RootDir))
    {
        return Err(format!("Path outside the vault: {rel}"));
    }
    Ok(root.join(rel_path))
}

fn to_rel(root: &Path, p: &Path) -> String {
    p.strip_prefix(root).unwrap_or(p).to_string_lossy().replace('\\', "/")
}

fn modified_iso(p: &Path) -> String {
    fs::metadata(p)
        .and_then(|m| m.modified())
        .map(|t| chrono::DateTime::<chrono::Local>::from(t).format("%Y-%m-%dT%H:%M:%S").to_string())
        .unwrap_or_default()
}

/// Pull `[[target]]`, `[[target|alias]]` and `[[target#heading]]` links out of a note.
fn wiki_links(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest = text;
    while let Some(start) = rest.find("[[") {
        let after = &rest[start + 2..];
        match after.find("]]") {
            Some(end) => {
                let inner = &after[..end];
                if !inner.contains('\n') {
                    let target = inner.split(['|', '#']).next().unwrap_or("").trim();
                    if !target.is_empty() {
                        out.push(target.to_string());
                    }
                }
                rest = &after[end + 2..];
            }
            None => break,
        }
    }
    out
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NoteMeta {
    pub path: String,
    pub title: String,
    pub modified: String,
    pub links: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultInfo {
    pub path: String,
}

#[tauri::command]
pub fn vault_info(state: State<AppState>) -> VaultInfo {
    VaultInfo { path: state.vault.lock().unwrap().to_string_lossy().to_string() }
}

#[tauri::command]
pub fn set_vault_path(state: State<AppState>, path: String) -> Result<(), String> {
    let p = PathBuf::from(&path);
    fs::create_dir_all(&p).str_err()?;
    crate::db::set_setting(state.clone(), "vault_path".into(), path)?;
    *state.vault.lock().unwrap() = p;
    Ok(())
}

#[tauri::command]
pub fn list_notes(state: State<AppState>) -> Result<Vec<NoteMeta>, String> {
    let root = state.vault.lock().unwrap().clone();
    let mut notes = Vec::new();
    for entry in WalkDir::new(&root)
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(Result::ok)
    {
        let p = entry.path();
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
        if !entry.file_type().is_file() || !(ext == "md" || ext == "txt") {
            continue;
        }
        let text = fs::read_to_string(p).unwrap_or_default();
        notes.push(NoteMeta {
            path: to_rel(&root, p),
            title: p.file_stem().unwrap_or_default().to_string_lossy().to_string(),
            modified: modified_iso(p),
            links: wiki_links(&text),
        });
    }
    notes.sort_by(|a, b| a.path.to_lowercase().cmp(&b.path.to_lowercase()));
    Ok(notes)
}

#[tauri::command]
pub fn read_note(state: State<AppState>, path: String) -> Result<String, String> {
    let root = state.vault.lock().unwrap().clone();
    fs::read_to_string(resolve(&root, &path)?).str_err()
}

#[tauri::command]
pub fn write_note(state: State<AppState>, path: String, content: String) -> Result<(), String> {
    let root = state.vault.lock().unwrap().clone();
    let full = resolve(&root, &path)?;
    if let Some(parent) = full.parent() {
        fs::create_dir_all(parent).str_err()?;
    }
    fs::write(full, content).str_err()
}

#[tauri::command]
pub fn rename_note(state: State<AppState>, from: String, to: String) -> Result<(), String> {
    let root = state.vault.lock().unwrap().clone();
    let (a, b) = (resolve(&root, &from)?, resolve(&root, &to)?);
    if b.exists() {
        return Err(format!("{to} already exists"));
    }
    if let Some(parent) = b.parent() {
        fs::create_dir_all(parent).str_err()?;
    }
    fs::rename(a, b).str_err()
}

/// Moves a vault file into `.trash/` (timestamped) rather than deleting it.
#[tauri::command]
pub fn trash_file(state: State<AppState>, path: String) -> Result<(), String> {
    let root = state.vault.lock().unwrap().clone();
    let src = resolve(&root, &path)?;
    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let dest = root.join(".trash").join(format!("{stamp}-{}", path.replace('/', "_")));
    fs::create_dir_all(dest.parent().unwrap()).str_err()?;
    fs::rename(src, dest).str_err()
}

// ---------- spreadsheets ----------

#[tauri::command]
pub fn list_sheets(state: State<AppState>) -> Result<Vec<NoteMeta>, String> {
    let root = state.vault.lock().unwrap().clone();
    let dir = root.join("Sheets");
    fs::create_dir_all(&dir).str_err()?;
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).str_err()?.filter_map(Result::ok) {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) == Some("vxsheet") {
            out.push(NoteMeta {
                path: to_rel(&root, &p),
                title: p.file_stem().unwrap_or_default().to_string_lossy().to_string(),
                modified: modified_iso(&p),
                links: vec![],
            });
        }
    }
    out.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    Ok(out)
}

/// Writes text to `Exports/<name>` and returns the absolute path.
#[tauri::command]
pub fn export_file(state: State<AppState>, name: String, content: String) -> Result<String, String> {
    let root = state.vault.lock().unwrap().clone();
    let full = resolve(&root, &format!("Exports/{name}"))?;
    fs::create_dir_all(full.parent().unwrap()).str_err()?;
    fs::write(&full, content).str_err()?;
    Ok(full.to_string_lossy().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_wiki_links() {
        let t = "See [[Alpha]] and [[Beta|b]] plus [[Gamma#Intro]]. Broken [[x";
        assert_eq!(wiki_links(t), vec!["Alpha", "Beta", "Gamma"]);
    }

    #[test]
    fn rejects_escape() {
        let root = Path::new("/vault");
        assert!(resolve(root, "../etc/passwd").is_err());
        assert!(resolve(root, "a/b.md").is_ok());
    }
}

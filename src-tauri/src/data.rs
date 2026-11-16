//! Data portability:
//!
//! * a generic JSON document store (`docs` table) used by newer modules;
//! * full export / import of everything as one versioned JSON file, so data
//!   moves between machines and between VaultX versions (imports tolerate
//!   missing and extra columns, and a backup is taken before every import);
//! * CSV export of any table;
//! * an opt-in, read-only local HTTP API on 127.0.0.1, protected by a token.

use std::collections::HashMap;
use std::fs;
use std::path::Path;
use std::sync::Arc;

use rusqlite::{params, types::ValueRef, Connection};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;

use crate::db::{get_setting_conn, SCHEMA_VERSION};
use crate::{AppState, StrErr};

/// Tables included in exports, in import order.
pub const TABLES: &[&str] = &[
    "settings", "lists", "tasks", "calendars", "external_events", "time_entries", "habits",
    "habit_checkins", "activities", "activity_details", "daily_metrics", "docs",
];
/// Machine-specific settings that should not travel with an export.
const LOCAL_SETTINGS: &[&str] = &["vault_path", "api_token", "api_enabled", "api_port"];

// ---------- document store ----------

#[tauri::command]
pub fn list_docs(state: State<AppState>, collection: String) -> Result<Vec<Value>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT data FROM docs WHERE collection = ?1").str_err()?;
    let rows = stmt.query_map([&collection], |r| r.get::<_, String>(0)).str_err()?;
    let mut out = Vec::new();
    for r in rows {
        if let Ok(v) = serde_json::from_str(&r.str_err()?) {
            out.push(v);
        }
    }
    Ok(out)
}

/// Saves `doc` (which must have a string `id`) into `collection`.
#[tauri::command]
pub fn save_doc(state: State<AppState>, collection: String, doc: Value) -> Result<(), String> {
    let id = doc.get("id").and_then(|v| v.as_str()).ok_or("document needs an id")?.to_string();
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO docs (collection, id, data, updated_at) VALUES (?1, ?2, ?3, ?4)",
        params![collection, id, doc.to_string(), chrono::Utc::now().to_rfc3339()],
    )
    .str_err()?;
    Ok(())
}

#[tauri::command]
pub fn delete_doc(state: State<AppState>, collection: String, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM docs WHERE collection = ?1 AND id = ?2", params![collection, id]).str_err()?;
    Ok(())
}

// ---------- table <-> JSON ----------

fn value_ref_to_json(v: ValueRef) -> Value {
    match v {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => json!(i),
        ValueRef::Real(f) => json!(f),
        ValueRef::Text(t) => Value::String(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => Value::String(format!("<{} bytes>", b.len())),
    }
}

pub fn dump_table(conn: &Connection, table: &str) -> rusqlite::Result<Vec<Value>> {
    let mut stmt = conn.prepare(&format!("SELECT * FROM {table}"))?;
    let names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
    let rows = stmt.query_map([], |r| {
        let mut obj = Map::new();
        for (i, n) in names.iter().enumerate() {
            obj.insert(n.clone(), value_ref_to_json(r.get_ref(i)?));
        }
        Ok(Value::Object(obj))
    })?;
    rows.collect()
}

fn table_columns(conn: &Connection, table: &str) -> rusqlite::Result<Vec<String>> {
    let mut stmt = conn.prepare(&format!("SELECT name FROM pragma_table_info('{table}')"))?;
    let cols = stmt.query_map([], |r| r.get::<_, String>(0))?;
    cols.collect()
}

fn json_to_sql(v: &Value) -> rusqlite::types::Value {
    use rusqlite::types::Value as S;
    match v {
        Value::Null => S::Null,
        Value::Bool(b) => S::Integer(*b as i64),
        Value::Number(n) => n.as_i64().map(S::Integer).unwrap_or_else(|| S::Real(n.as_f64().unwrap_or(0.0))),
        Value::String(s) => S::Text(s.clone()),
        other => S::Text(other.to_string()),
    }
}

// ---------- export ----------

fn vault_files(vault: &Path) -> Map<String, Value> {
    let mut files = Map::new();
    for e in WalkDir::new(vault)
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.') && e.file_name() != "Exports")
        .filter_map(Result::ok)
    {
        let p = e.path();
        let ext = p.extension().and_then(|x| x.to_str()).unwrap_or("").to_lowercase();
        if e.file_type().is_file() && matches!(ext.as_str(), "md" | "txt" | "vxsheet") {
            if let Ok(text) = fs::read_to_string(p) {
                let rel = p.strip_prefix(vault).unwrap().to_string_lossy().replace('\\', "/");
                files.insert(rel, Value::String(text));
            }
        }
    }
    files
}

pub fn build_export(conn: &Connection, vault: &Path) -> Result<Value, String> {
    let mut tables = Map::new();
    for t in TABLES {
        let mut rows = dump_table(conn, t).str_err()?;
        if *t == "settings" {
            rows.retain(|r| !LOCAL_SETTINGS.contains(&r["key"].as_str().unwrap_or("")));
        }
        tables.insert(t.to_string(), Value::Array(rows));
    }
    Ok(json!({
        "format": "vaultx-export",
        "schemaVersion": SCHEMA_VERSION,
        "appVersion": env!("CARGO_PKG_VERSION"),
        "exportedAt": chrono::Local::now().to_rfc3339(),
        "tables": tables,
        "vault": vault_files(vault),
    }))
}

fn write_export(state: &State<AppState>, prefix: &str) -> Result<String, String> {
    let vault = state.vault.lock().unwrap().clone();
    let data = {
        let db = state.db.lock().unwrap();
        build_export(&db, &vault)?
    };
    let dir = vault.join("Exports");
    fs::create_dir_all(&dir).str_err()?;
    let path = dir.join(format!("{prefix}-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    fs::write(&path, serde_json::to_string_pretty(&data).unwrap()).str_err()?;
    Ok(path.to_string_lossy().to_string())
}

/// Writes a full backup to `<vault>/Exports/vaultx-backup-<time>.json`.
#[tauri::command]
pub fn export_all(state: State<AppState>) -> Result<String, String> {
    write_export(&state, "vaultx-backup")
}

/// Exports one table as CSV into `<vault>/Exports/`.
#[tauri::command]
pub fn export_csv(state: State<AppState>, table: String) -> Result<String, String> {
    if !TABLES.contains(&table.as_str()) {
        return Err(format!("Unknown table {table}"));
    }
    let rows = {
        let db = state.db.lock().unwrap();
        dump_table(&db, &table).str_err()?
    };
    let cols: Vec<String> = rows
        .first()
        .and_then(|r| r.as_object())
        .map(|o| o.keys().cloned().collect())
        .unwrap_or_default();
    let esc = |s: String| if s.contains([',', '"', '\n']) { format!("\"{}\"", s.replace('"', "\"\"")) } else { s };
    let mut out = cols.join(",") + "\n";
    for r in &rows {
        let line: Vec<String> = cols
            .iter()
            .map(|c| match &r[c] {
                Value::Null => String::new(),
                Value::String(s) => esc(s.clone()),
                v => esc(v.to_string()),
            })
            .collect();
        out += &(line.join(",") + "\n");
    }
    let vault = state.vault.lock().unwrap().clone();
    let path = vault.join("Exports").join(format!("{table}.csv"));
    fs::create_dir_all(path.parent().unwrap()).str_err()?;
    fs::write(&path, out).str_err()?;
    Ok(path.to_string_lossy().to_string())
}

// ---------- import ----------

/// Imports a `vaultx-export` JSON. Rows are upserted by primary key; columns
/// unknown to this version are ignored and missing ones take their defaults,
/// so exports from older or newer versions both work. Vault files are written
/// when absent, or overwritten only if `overwrite_files` is true.
#[tauri::command]
pub fn import_all(state: State<AppState>, text: String, overwrite_files: bool) -> Result<Value, String> {
    let data: Value = serde_json::from_str(&text).map_err(|e| format!("Not a valid export file: {e}"))?;
    if data["format"] != "vaultx-export" {
        return Err("This file is not a VaultX export".into());
    }
    let backup = write_export(&state, "pre-import-backup")?;
    let vault = state.vault.lock().unwrap().clone();
    let mut db = state.db.lock().unwrap();
    let mut result = import_data(&mut db, &vault, &data, overwrite_files)?;
    result["backup"] = json!(backup);
    Ok(result)
}

/// Core of import_all, separate so it can be tested without the app.
pub fn import_data(db: &mut Connection, vault: &Path, data: &Value, overwrite_files: bool) -> Result<Value, String> {
    let mut counts: HashMap<String, usize> = HashMap::new();
    {
        let tx = db.transaction().str_err()?;
        for t in TABLES {
            let Some(rows) = data["tables"][*t].as_array() else { continue };
            let cols = table_columns(&tx, t).str_err()?;
            let mut n = 0;
            for row in rows {
                let Some(obj) = row.as_object() else { continue };
                if *t == "settings" && LOCAL_SETTINGS.contains(&obj.get("key").and_then(|k| k.as_str()).unwrap_or("")) {
                    continue;
                }
                let use_cols: Vec<&String> = cols.iter().filter(|c| obj.contains_key(*c)).collect();
                if use_cols.is_empty() {
                    continue;
                }
                let sql = format!(
                    "INSERT OR REPLACE INTO {t} ({}) VALUES ({})",
                    use_cols.iter().map(|c| c.as_str()).collect::<Vec<_>>().join(", "),
                    (1..=use_cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ")
                );
                let vals: Vec<rusqlite::types::Value> = use_cols.iter().map(|c| json_to_sql(&obj[*c])).collect();
                tx.execute(&sql, rusqlite::params_from_iter(vals)).str_err()?;
                n += 1;
            }
            counts.insert(t.to_string(), n);
        }
        tx.commit().str_err()?;
    }

    let (mut written, mut skipped) = (0, 0);
    if let Some(files) = data["vault"].as_object() {
        for (rel, content) in files {
            if rel.contains("..") || Path::new(rel).is_absolute() {
                continue;
            }
            let path = vault.join(rel);
            if path.exists() && !overwrite_files {
                skipped += 1;
                continue;
            }
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).str_err()?;
            }
            fs::write(&path, content.as_str().unwrap_or("")).str_err()?;
            written += 1;
        }
    }
    Ok(json!({
        "rows": counts,
        "filesWritten": written,
        "filesSkipped": skipped,
        "fromVersion": data["appVersion"],
    }))
}

// ---------- local API ----------

pub struct ApiServer {
    server: Arc<tiny_http::Server>,
    pub port: u16,
}

impl Drop for ApiServer {
    fn drop(&mut self) {
        self.server.unblock();
    }
}

fn respond(req: tiny_http::Request, code: u16, body: Value) {
    let resp = tiny_http::Response::from_string(body.to_string())
        .with_status_code(code)
        .with_header("Content-Type: application/json".parse::<tiny_http::Header>().unwrap());
    let _ = req.respond(resp);
}

fn handle(app: &AppHandle, token: &str, req: tiny_http::Request) {
    if req.method() != &tiny_http::Method::Get {
        return respond(req, 405, json!({"error": "read-only API: use GET"}));
    }
    let url = req.url().to_string();
    let (path, query) = url.split_once('?').unwrap_or((&url, ""));
    let header_ok = req.headers().iter().any(|h| {
        h.field.equiv("Authorization") && h.value.as_str() == format!("Bearer {token}")
    });
    let query_ok = query.split('&').any(|kv| kv == format!("token={token}"));
    if !(header_ok || query_ok) {
        return respond(req, 401, json!({"error": "missing or wrong token"}));
    }
    let state = app.state::<AppState>();
    let parts: Vec<&str> = path.trim_matches('/').split('/').collect();
    let result: Result<Value, String> = match parts.as_slice() {
        ["api", "v1"] | ["api", "v1", "health"] => Ok(json!({
            "ok": true, "app": "VaultX", "version": env!("CARGO_PKG_VERSION"),
            "schemaVersion": SCHEMA_VERSION, "tables": TABLES,
            "endpoints": ["/api/v1/export", "/api/v1/<table>", "/api/v1/docs/<collection>", "/api/v1/notes", "/api/v1/notes/<path>"],
        })),
        ["api", "v1", "export"] => {
            let vault = state.vault.lock().unwrap().clone();
            let db = state.db.lock().unwrap();
            build_export(&db, &vault)
        }
        ["api", "v1", "notes"] => {
            let vault = state.vault.lock().unwrap().clone();
            Ok(json!(vault_files(&vault).keys().collect::<Vec<_>>()))
        }
        ["api", "v1", "notes", rest @ ..] => {
            let vault = state.vault.lock().unwrap().clone();
            let rel = rest.join("/").replace("%20", " ");
            vault_files(&vault).get(&rel).cloned().map(|c| json!({"path": rel, "content": c})).ok_or("note not found".into())
        }
        ["api", "v1", "docs", collection] => {
            let db = state.db.lock().unwrap();
            dump_table(&db, "docs").str_err().map(|rows| {
                json!(rows
                    .into_iter()
                    .filter(|r| r["collection"] == *collection)
                    .filter_map(|r| serde_json::from_str::<Value>(r["data"].as_str().unwrap_or("")).ok())
                    .collect::<Vec<_>>())
            })
        }
        ["api", "v1", table] if TABLES.contains(table) && *table != "settings" => {
            let db = state.db.lock().unwrap();
            dump_table(&db, table).str_err().map(Value::Array)
        }
        _ => Err("unknown endpoint - try /api/v1/health".into()),
    };
    match result {
        Ok(v) => respond(req, 200, v),
        Err(e) => respond(req, 404, json!({"error": e})),
    }
}

pub fn start_api(app: &AppHandle, port: u16, token: String) -> Result<ApiServer, String> {
    let server = Arc::new(
        tiny_http::Server::http(("127.0.0.1", port)).map_err(|e| format!("Could not open port {port}: {e}"))?,
    );
    let s = server.clone();
    let app = app.clone();
    std::thread::spawn(move || {
        for req in s.incoming_requests() {
            handle(&app, &token, req);
        }
    });
    Ok(ApiServer { server, port })
}

fn api_settings(conn: &Connection) -> (bool, u16, String) {
    let enabled = get_setting_conn(conn, "api_enabled").as_deref() == Some("1");
    let port = get_setting_conn(conn, "api_port").and_then(|p| p.parse().ok()).unwrap_or(47821);
    let token = get_setting_conn(conn, "api_token").unwrap_or_default();
    (enabled, port, token)
}

fn ensure_token(conn: &Connection) -> String {
    let (_, _, token) = api_settings(conn);
    if !token.is_empty() {
        return token;
    }
    let t = uuid::Uuid::new_v4().simple().to_string();
    let _ = conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('api_token', ?1)",
        [&t],
    );
    t
}

/// Starts the API at launch if the user enabled it.
pub fn autostart_api(app: &AppHandle) {
    let state = app.state::<AppState>();
    let (enabled, port, token) = {
        let db = state.db.lock().unwrap();
        let (e, p, _) = api_settings(&db);
        (e, p, ensure_token(&db))
    };
    if enabled {
        if let Ok(s) = start_api(app, port, token) {
            *state.api.lock().unwrap() = Some(s);
        }
    }
}

#[tauri::command]
pub fn api_status(state: State<AppState>) -> Value {
    let db = state.db.lock().unwrap();
    let (enabled, port, _) = api_settings(&db);
    let token = ensure_token(&db);
    let running = state.api.lock().unwrap().as_ref().map(|s| s.port);
    json!({ "enabled": enabled, "port": port, "token": token, "running": running.is_some() })
}

#[tauri::command]
pub fn api_configure(app: AppHandle, enabled: bool, port: u16, new_token: bool) -> Result<Value, String> {
    let state = app.state::<AppState>();
    let token = {
        let db = state.db.lock().unwrap();
        if new_token {
            db.execute("DELETE FROM settings WHERE key = 'api_token'", []).str_err()?;
        }
        db.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('api_enabled', ?1), ('api_port', ?2)",
            params![if enabled { "1" } else { "0" }, port.to_string()],
        )
        .str_err()?;
        ensure_token(&db)
    };
    // Stop any running server, then start with the new settings.
    *state.api.lock().unwrap() = None;
    if enabled {
        let s = start_api(&app, port, token)?;
        *state.api.lock().unwrap() = Some(s);
    }
    Ok(api_status(state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_import_roundtrip_tolerates_schema_drift() {
        let dir = std::env::temp_dir().join(format!("vaultx-test-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let conn = crate::db::open(&dir.join("a.db")).unwrap();
        conn.execute(
            "INSERT INTO tasks (id, list_id, title, created_at, updated_at) VALUES ('t1', 'inbox', 'Hello', 'x', 'x')",
            [],
        )
        .unwrap();
        let exp = build_export(&conn, &dir).unwrap();
        assert_eq!(exp["format"], "vaultx-export");
        let tasks = exp["tables"]["tasks"].as_array().unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0]["title"], "Hello");
        let cols = table_columns(&conn, "tasks").unwrap();
        assert!(cols.contains(&"checklist".to_string()));

        // Import into a fresh database: an "old version" row without the newer
        // columns, plus a column this version does not know, plus a note.
        let mut fresh = crate::db::open(&dir.join("b.db")).unwrap();
        let old = json!({
            "format": "vaultx-export", "appVersion": "0.0.1",
            "tables": { "tasks": [{ "id": "t9", "list_id": "inbox", "title": "From the past",
                                    "created_at": "x", "updated_at": "x", "future_column": 42 }] },
            "vault": { "Old note.md": "# hi", "../escape.md": "nope" }
        });
        let vault = dir.join("vault");
        let r = import_data(&mut fresh, &vault, &old, false).unwrap();
        assert_eq!(r["rows"]["tasks"], 1);
        assert_eq!(r["filesWritten"], 1);
        let (title, checklist): (String, String) = fresh
            .query_row("SELECT title, checklist FROM tasks WHERE id = 't9'", [], |r| Ok((r.get(0)?, r.get(1)?)))
            .unwrap();
        assert_eq!(title, "From the past");
        assert_eq!(checklist, "[]"); // default filled in
        assert!(vault.join("Old note.md").exists());
        assert!(!dir.join("escape.md").exists());
        // Re-importing does not duplicate rows and keeps existing files.
        let r2 = import_data(&mut fresh, &vault, &old, false).unwrap();
        assert_eq!(r2["filesSkipped"], 1);
        let n: i64 = fresh.query_row("SELECT COUNT(*) FROM tasks", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 1);
        let _ = fs::remove_dir_all(&dir);
    }
}

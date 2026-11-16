//! SQLite storage for structured data: task lists, tasks, calendar
//! subscriptions, imported events, training activities and settings.
//! Notes and spreadsheets are plain files in the vault (see vault.rs).

use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::State;

use crate::{AppState, StrErr};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS lists (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    list_id TEXT NOT NULL,
    title TEXT NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    tags TEXT NOT NULL DEFAULT '[]',
    priority INTEGER NOT NULL DEFAULT 0,
    due_date TEXT,
    start_at TEXT,
    end_at TEXT,
    done INTEGER NOT NULL DEFAULT 0,
    completed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    sort INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS calendars (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    last_synced TEXT
);
CREATE TABLE IF NOT EXISTS external_events (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    title TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT,
    all_day INTEGER NOT NULL DEFAULT 0,
    location TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    external_id TEXT NOT NULL,
    sport TEXT NOT NULL,
    name TEXT NOT NULL DEFAULT '',
    start_time TEXT NOT NULL,
    duration_s REAL NOT NULL DEFAULT 0,
    distance_m REAL,
    avg_hr REAL,
    max_hr REAL,
    elevation_m REAL,
    calories REAL,
    avg_power REAL,
    raw TEXT,
    UNIQUE(source, external_id)
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"#;

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    conn.execute_batch(SCHEMA)?;
    // First run: seed a default inbox list.
    let count: i64 = conn.query_row("SELECT COUNT(*) FROM lists", [], |r| r.get(0))?;
    if count == 0 {
        conn.execute(
            "INSERT INTO lists (id, name, color, sort) VALUES ('inbox', 'Inbox', '', 0)",
            [],
        )?;
    }
    Ok(conn)
}

pub fn get_setting_conn(conn: &Connection, key: &str) -> Option<String> {
    conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0))
        .optional()
        .ok()
        .flatten()
}

// ---------- settings ----------

#[tauri::command]
pub fn get_settings(state: State<AppState>) -> Result<std::collections::HashMap<String, String>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT key, value FROM settings").str_err()?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

#[tauri::command]
pub fn set_setting(state: State<AppState>, key: String, value: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT INTO settings (key, value) VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        params![key, value],
    )
    .str_err()?;
    Ok(())
}

// ---------- lists ----------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort: i64,
}

#[tauri::command]
pub fn list_lists(state: State<AppState>) -> Result<Vec<TaskList>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, name, color, sort FROM lists ORDER BY sort, name")
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TaskList { id: r.get(0)?, name: r.get(1)?, color: r.get(2)?, sort: r.get(3)? })
        })
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

#[tauri::command]
pub fn save_list(state: State<AppState>, list: TaskList) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO lists (id, name, color, sort) VALUES (?1, ?2, ?3, ?4)",
        params![list.id, list.name, list.color, list.sort],
    )
    .str_err()?;
    Ok(())
}

#[tauri::command]
pub fn delete_list(state: State<AppState>, id: String) -> Result<(), String> {
    if id == "inbox" {
        return Err("The Inbox list cannot be deleted".into());
    }
    let db = state.db.lock().unwrap();
    // Orphaned tasks fall back to the inbox rather than vanishing.
    db.execute("UPDATE tasks SET list_id = 'inbox' WHERE list_id = ?1", [&id]).str_err()?;
    db.execute("DELETE FROM lists WHERE id = ?1", [&id]).str_err()?;
    Ok(())
}

// ---------- tasks ----------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub list_id: String,
    pub title: String,
    pub note: String,
    pub tags: Vec<String>,
    pub priority: i64,
    pub due_date: Option<String>,
    pub start_at: Option<String>,
    pub end_at: Option<String>,
    pub done: bool,
    pub completed_at: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub sort: i64,
}

#[tauri::command]
pub fn list_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, list_id, title, note, tags, priority, due_date, start_at, end_at,
                    done, completed_at, created_at, updated_at, sort
             FROM tasks ORDER BY done, sort, created_at",
        )
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            let tags: String = r.get(4)?;
            Ok(Task {
                id: r.get(0)?,
                list_id: r.get(1)?,
                title: r.get(2)?,
                note: r.get(3)?,
                tags: serde_json::from_str(&tags).unwrap_or_default(),
                priority: r.get(5)?,
                due_date: r.get(6)?,
                start_at: r.get(7)?,
                end_at: r.get(8)?,
                done: r.get::<_, i64>(9)? != 0,
                completed_at: r.get(10)?,
                created_at: r.get(11)?,
                updated_at: r.get(12)?,
                sort: r.get(13)?,
            })
        })
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

#[tauri::command]
pub fn save_task(state: State<AppState>, task: Task) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO tasks
         (id, list_id, title, note, tags, priority, due_date, start_at, end_at,
          done, completed_at, created_at, updated_at, sort)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            task.id,
            task.list_id,
            task.title,
            task.note,
            serde_json::to_string(&task.tags).unwrap(),
            task.priority,
            task.due_date,
            task.start_at,
            task.end_at,
            task.done as i64,
            task.completed_at,
            task.created_at,
            task.updated_at,
            task.sort
        ],
    )
    .str_err()?;
    Ok(())
}

#[tauri::command]
pub fn delete_task(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM tasks WHERE id = ?1", [id]).str_err()?;
    Ok(())
}

// ---------- external calendars (ICS subscriptions) ----------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub name: String,
    pub url: String,
    pub color: String,
    pub last_synced: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalEvent {
    pub id: String,
    pub calendar_id: String,
    pub uid: String,
    pub title: String,
    pub start_at: String,
    pub end_at: Option<String>,
    pub all_day: bool,
    pub location: String,
    pub description: String,
}

#[tauri::command]
pub fn list_calendars(state: State<AppState>) -> Result<Vec<Calendar>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, name, url, color, last_synced FROM calendars ORDER BY name")
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Calendar {
                id: r.get(0)?,
                name: r.get(1)?,
                url: r.get(2)?,
                color: r.get(3)?,
                last_synced: r.get(4)?,
            })
        })
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

#[tauri::command]
pub fn save_calendar(state: State<AppState>, calendar: Calendar) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO calendars (id, name, url, color, last_synced) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![calendar.id, calendar.name, calendar.url, calendar.color, calendar.last_synced],
    )
    .str_err()?;
    Ok(())
}

#[tauri::command]
pub fn delete_calendar(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM external_events WHERE calendar_id = ?1", [&id]).str_err()?;
    db.execute("DELETE FROM calendars WHERE id = ?1", [&id]).str_err()?;
    Ok(())
}

/// Replaces every stored event of one calendar with a freshly parsed set.
#[tauri::command]
pub fn replace_calendar_events(
    state: State<AppState>,
    calendar_id: String,
    events: Vec<ExternalEvent>,
) -> Result<(), String> {
    let mut db = state.db.lock().unwrap();
    let tx = db.transaction().str_err()?;
    tx.execute("DELETE FROM external_events WHERE calendar_id = ?1", [&calendar_id]).str_err()?;
    for e in events {
        tx.execute(
            "INSERT OR REPLACE INTO external_events
             (id, calendar_id, uid, title, start_at, end_at, all_day, location, description)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                e.id, calendar_id, e.uid, e.title, e.start_at, e.end_at, e.all_day as i64,
                e.location, e.description
            ],
        )
        .str_err()?;
    }
    tx.commit().str_err()
}

#[tauri::command]
pub fn list_external_events(state: State<AppState>) -> Result<Vec<ExternalEvent>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, calendar_id, uid, title, start_at, end_at, all_day, location, description
             FROM external_events ORDER BY start_at",
        )
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            Ok(ExternalEvent {
                id: r.get(0)?,
                calendar_id: r.get(1)?,
                uid: r.get(2)?,
                title: r.get(3)?,
                start_at: r.get(4)?,
                end_at: r.get(5)?,
                all_day: r.get::<_, i64>(6)? != 0,
                location: r.get(7)?,
                description: r.get(8)?,
            })
        })
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

// ---------- activities ----------

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Activity {
    pub id: String,
    pub source: String,
    pub external_id: String,
    pub sport: String,
    pub name: String,
    /// Local start time, "YYYY-MM-DDTHH:MM:SS".
    pub start_time: String,
    pub duration_s: f64,
    pub distance_m: Option<f64>,
    pub avg_hr: Option<f64>,
    pub max_hr: Option<f64>,
    pub elevation_m: Option<f64>,
    pub calories: Option<f64>,
    pub avg_power: Option<f64>,
}

pub fn upsert_activities(conn: &mut Connection, acts: &[Activity], raw: &[Option<String>]) -> rusqlite::Result<usize> {
    let tx = conn.transaction()?;
    let mut n = 0;
    for (i, a) in acts.iter().enumerate() {
        n += tx.execute(
            "INSERT INTO activities
             (id, source, external_id, sport, name, start_time, duration_s, distance_m,
              avg_hr, max_hr, elevation_m, calories, avg_power, raw)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
             ON CONFLICT(source, external_id) DO UPDATE SET
               sport = excluded.sport, name = excluded.name, start_time = excluded.start_time,
               duration_s = excluded.duration_s, distance_m = excluded.distance_m,
               avg_hr = excluded.avg_hr, max_hr = excluded.max_hr,
               elevation_m = excluded.elevation_m, calories = excluded.calories,
               avg_power = excluded.avg_power, raw = excluded.raw",
            params![
                a.id, a.source, a.external_id, a.sport, a.name, a.start_time, a.duration_s,
                a.distance_m, a.avg_hr, a.max_hr, a.elevation_m, a.calories, a.avg_power,
                raw.get(i).cloned().flatten()
            ],
        )?;
    }
    tx.commit()?;
    Ok(n)
}

#[tauri::command]
pub fn list_activities(state: State<AppState>) -> Result<Vec<Activity>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, source, external_id, sport, name, start_time, duration_s, distance_m,
                    avg_hr, max_hr, elevation_m, calories, avg_power
             FROM activities ORDER BY start_time DESC",
        )
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            Ok(Activity {
                id: r.get(0)?,
                source: r.get(1)?,
                external_id: r.get(2)?,
                sport: r.get(3)?,
                name: r.get(4)?,
                start_time: r.get(5)?,
                duration_s: r.get(6)?,
                distance_m: r.get(7)?,
                avg_hr: r.get(8)?,
                max_hr: r.get(9)?,
                elevation_m: r.get(10)?,
                calories: r.get(11)?,
                avg_power: r.get(12)?,
            })
        })
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

#[tauri::command]
pub fn save_activity(state: State<AppState>, activity: Activity) -> Result<(), String> {
    let mut db = state.db.lock().unwrap();
    upsert_activities(&mut db, &[activity], &[None]).str_err()?;
    Ok(())
}

#[tauri::command]
pub fn delete_activity(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM activities WHERE id = ?1", [id]).str_err()?;
    Ok(())
}

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
CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    task_id TEXT,
    title TEXT NOT NULL DEFAULT '',
    start_at TEXT NOT NULL,
    end_at TEXT,
    mode TEXT NOT NULL DEFAULT 'stopwatch',
    target_min INTEGER,
    note TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS time_entries_start ON time_entries(start_at);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS habits (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '',
    frequency TEXT NOT NULL DEFAULT '{"type":"daily"}',
    goal REAL NOT NULL DEFAULT 1,
    unit TEXT NOT NULL DEFAULT '',
    section TEXT NOT NULL DEFAULT 'any',
    reminder TEXT,
    archived INTEGER NOT NULL DEFAULT 0,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS habit_checkins (
    habit_id TEXT NOT NULL,
    date TEXT NOT NULL,
    value REAL NOT NULL,
    PRIMARY KEY (habit_id, date)
);
CREATE TABLE IF NOT EXISTS activity_details (
    activity_id TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS daily_metrics (
    date TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
-- Generic JSON document store for newer modules (diet, saved filters...).
CREATE TABLE IF NOT EXISTS docs (
    collection TEXT NOT NULL,
    id TEXT NOT NULL,
    data TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (collection, id)
);
"#;

/// Bumped whenever the schema changes; written into exports so imports can adapt.
pub const SCHEMA_VERSION: i64 = 2;

/// Columns added after v0.0.2. `ALTER TABLE ADD COLUMN` keeps existing rows,
/// so upgrading an installed copy never loses data.
const MIGRATIONS: &[(&str, &str, &str)] = &[
    ("tasks", "checklist", "TEXT NOT NULL DEFAULT '[]'"),
    ("tasks", "recurrence", "TEXT"),
    ("tasks", "reminders", "TEXT NOT NULL DEFAULT '[]'"),
    ("tasks", "wont_do", "INTEGER NOT NULL DEFAULT 0"),
    ("tasks", "pinned", "INTEGER NOT NULL DEFAULT 0"),
    ("tasks", "section", "TEXT NOT NULL DEFAULT ''"),
    ("tasks", "estimate_pomos", "INTEGER NOT NULL DEFAULT 0"),
    ("tasks", "deleted_at", "TEXT"),
    ("lists", "folder", "TEXT NOT NULL DEFAULT ''"),
    ("lists", "archived", "INTEGER NOT NULL DEFAULT 0"),
    ("lists", "view", "TEXT NOT NULL DEFAULT 'list'"),
    ("lists", "sections", "TEXT NOT NULL DEFAULT '[]'"),
];

fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    for (table, col, decl) in MIGRATIONS {
        let exists: bool = conn
            .prepare(&format!("SELECT 1 FROM pragma_table_info('{table}') WHERE name = ?1"))?
            .exists([col])?;
        if !exists {
            conn.execute_batch(&format!("ALTER TABLE {table} ADD COLUMN {col} {decl}"))?;
        }
    }
    Ok(())
}

pub fn open(path: &std::path::Path) -> rusqlite::Result<Connection> {
    let conn = Connection::open(path)?;
    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")?;
    conn.execute_batch(SCHEMA)?;
    migrate(&conn)?;
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

/// ---------- lists ----------

fn json_col<T: serde::de::DeserializeOwned + Default>(s: Option<String>) -> T {
    s.and_then(|v| serde_json::from_str(&v).ok()).unwrap_or_default()
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskList {
    pub id: String,
    pub name: String,
    pub color: String,
    pub sort: i64,
    #[serde(default)]
    pub folder: String,
    #[serde(default)]
    pub archived: bool,
    /// "list" or "kanban"
    #[serde(default = "default_view")]
    pub view: String,
    /// Kanban column / section names, in order.
    #[serde(default)]
    pub sections: Vec<String>,
}
fn default_view() -> String {
    "list".into()
}

#[tauri::command]
pub fn list_lists(state: State<AppState>) -> Result<Vec<TaskList>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare("SELECT id, name, color, sort, folder, archived, view, sections FROM lists ORDER BY sort, name")
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TaskList {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                sort: r.get(3)?,
                folder: r.get(4)?,
                archived: r.get::<_, i64>(5)? != 0,
                view: r.get(6)?,
                sections: json_col(r.get(7)?),
            })
        })
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

#[tauri::command]
pub fn save_list(state: State<AppState>, list: TaskList) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO lists (id, name, color, sort, folder, archived, view, sections)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            list.id,
            list.name,
            list.color,
            list.sort,
            list.folder,
            list.archived as i64,
            list.view,
            serde_json::to_string(&list.sections).unwrap()
        ],
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
    /// Subtask checklist: [{ id, title, done }]
    #[serde(default)]
    pub checklist: serde_json::Value,
    /// Repeat rule, see src/lib/recurrence.ts
    #[serde(default)]
    pub recurrence: Option<serde_json::Value>,
    /// Reminder offsets in minutes before the start/due time.
    #[serde(default)]
    pub reminders: Vec<i64>,
    #[serde(default)]
    pub wont_do: bool,
    #[serde(default)]
    pub pinned: bool,
    #[serde(default)]
    pub section: String,
    #[serde(default)]
    pub estimate_pomos: i64,
    /// Set when moved to Trash.
    #[serde(default)]
    pub deleted_at: Option<String>,
}

#[tauri::command]
pub fn list_tasks(state: State<AppState>) -> Result<Vec<Task>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, list_id, title, note, tags, priority, due_date, start_at, end_at,
                    done, completed_at, created_at, updated_at, sort,
                    checklist, recurrence, reminders, wont_do, pinned, section, estimate_pomos, deleted_at
             FROM tasks ORDER BY done, sort, created_at",
        )
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            let checklist: Option<String> = r.get(14)?;
            let recurrence: Option<String> = r.get(15)?;
            Ok(Task {
                id: r.get(0)?,
                list_id: r.get(1)?,
                title: r.get(2)?,
                note: r.get(3)?,
                tags: json_col(r.get(4)?),
                priority: r.get(5)?,
                due_date: r.get(6)?,
                start_at: r.get(7)?,
                end_at: r.get(8)?,
                done: r.get::<_, i64>(9)? != 0,
                completed_at: r.get(10)?,
                created_at: r.get(11)?,
                updated_at: r.get(12)?,
                sort: r.get(13)?,
                checklist: checklist
                    .and_then(|v| serde_json::from_str(&v).ok())
                    .unwrap_or_else(|| serde_json::json!([])),
                recurrence: recurrence.and_then(|v| serde_json::from_str(&v).ok()),
                reminders: json_col(r.get(16)?),
                wont_do: r.get::<_, i64>(17)? != 0,
                pinned: r.get::<_, i64>(18)? != 0,
                section: r.get(19)?,
                estimate_pomos: r.get(20)?,
                deleted_at: r.get(21)?,
            })
        })
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

#[tauri::command]
pub fn save_task(state: State<AppState>, task: Task) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    let checklist = if task.checklist.is_null() { "[]".to_string() } else { task.checklist.to_string() };
    db.execute(
        "INSERT OR REPLACE INTO tasks
         (id, list_id, title, note, tags, priority, due_date, start_at, end_at,
          done, completed_at, created_at, updated_at, sort,
          checklist, recurrence, reminders, wont_do, pinned, section, estimate_pomos, deleted_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14,
                 ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22)",
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
            task.sort,
            checklist,
            task.recurrence.as_ref().map(|v| v.to_string()),
            serde_json::to_string(&task.reminders).unwrap(),
            task.wont_do as i64,
            task.pinned as i64,
            task.section,
            task.estimate_pomos,
            task.deleted_at
        ],
    )
    .str_err()?;
    Ok(())
}

/// Permanent delete (used by "Delete forever" in Trash).
#[tauri::command]
pub fn delete_task(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM tasks WHERE id = ?1", [id]).str_err()?;
    Ok(())
}

// ---------- habits ----------

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Habit {
    pub id: String,
    pub name: String,
    pub color: String,
    /// { type: "daily" } | { type: "weekdays", days: [0..6] } | { type: "perWeek", times: n }
    pub frequency: serde_json::Value,
    /// Target per day (1 for a simple check-in, e.g. 8 for "8 glasses").
    pub goal: f64,
    pub unit: String,
    /// "morning" | "afternoon" | "evening" | "any"
    pub section: String,
    /// "HH:MM" daily reminder.
    pub reminder: Option<String>,
    pub archived: bool,
    pub sort: i64,
    pub created_at: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HabitCheckin {
    pub habit_id: String,
    pub date: String,
    pub value: f64,
}

#[tauri::command]
pub fn list_habits(state: State<AppState>) -> Result<Vec<Habit>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, name, color, frequency, goal, unit, section, reminder, archived, sort, created_at
             FROM habits ORDER BY sort, created_at",
        )
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            let freq: String = r.get(3)?;
            Ok(Habit {
                id: r.get(0)?,
                name: r.get(1)?,
                color: r.get(2)?,
                frequency: serde_json::from_str(&freq).unwrap_or(serde_json::json!({"type": "daily"})),
                goal: r.get(4)?,
                unit: r.get(5)?,
                section: r.get(6)?,
                reminder: r.get(7)?,
                archived: r.get::<_, i64>(8)? != 0,
                sort: r.get(9)?,
                created_at: r.get(10)?,
            })
        })
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

#[tauri::command]
pub fn save_habit(state: State<AppState>, habit: Habit) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO habits
         (id, name, color, frequency, goal, unit, section, reminder, archived, sort, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            habit.id,
            habit.name,
            habit.color,
            habit.frequency.to_string(),
            habit.goal,
            habit.unit,
            habit.section,
            habit.reminder,
            habit.archived as i64,
            habit.sort,
            habit.created_at
        ],
    )
    .str_err()?;
    Ok(())
}

#[tauri::command]
pub fn delete_habit(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM habit_checkins WHERE habit_id = ?1", [&id]).str_err()?;
    db.execute("DELETE FROM habits WHERE id = ?1", [&id]).str_err()?;
    Ok(())
}

#[tauri::command]
pub fn list_checkins(state: State<AppState>) -> Result<Vec<HabitCheckin>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT habit_id, date, value FROM habit_checkins").str_err()?;
    let rows = stmt
        .query_map([], |r| Ok(HabitCheckin { habit_id: r.get(0)?, date: r.get(1)?, value: r.get(2)? }))
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

/// A value of 0 or less removes the check-in for that day.
#[tauri::command]
pub fn set_checkin(state: State<AppState>, checkin: HabitCheckin) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    if checkin.value <= 0.0 {
        db.execute(
            "DELETE FROM habit_checkins WHERE habit_id = ?1 AND date = ?2",
            params![checkin.habit_id, checkin.date],
        )
        .str_err()?;
    } else {
        db.execute(
            "INSERT OR REPLACE INTO habit_checkins (habit_id, date, value) VALUES (?1, ?2, ?3)",
            params![checkin.habit_id, checkin.date, checkin.value],
        )
        .str_err()?;
    }
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

// ---------- time tracking ----------

/// A tracked stretch of time. `end_at = None` means the timer is running;
/// it is written at start so a running timer survives restarts and crashes.
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeEntry {
    pub id: String,
    pub task_id: Option<String>,
    pub title: String,
    /// Local "YYYY-MM-DDTHH:MM:SS".
    pub start_at: String,
    pub end_at: Option<String>,
    /// "stopwatch" or "pomodoro".
    pub mode: String,
    pub target_min: Option<i64>,
    pub note: String,
}

#[tauri::command]
pub fn list_time_entries(state: State<AppState>) -> Result<Vec<TimeEntry>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db
        .prepare(
            "SELECT id, task_id, title, start_at, end_at, mode, target_min, note
             FROM time_entries ORDER BY start_at",
        )
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            Ok(TimeEntry {
                id: r.get(0)?,
                task_id: r.get(1)?,
                title: r.get(2)?,
                start_at: r.get(3)?,
                end_at: r.get(4)?,
                mode: r.get(5)?,
                target_min: r.get(6)?,
                note: r.get(7)?,
            })
        })
        .str_err()?;
    rows.collect::<Result<_, _>>().str_err()
}

#[tauri::command]
pub fn save_time_entry(state: State<AppState>, entry: TimeEntry) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute(
        "INSERT OR REPLACE INTO time_entries
         (id, task_id, title, start_at, end_at, mode, target_min, note)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            entry.id, entry.task_id, entry.title, entry.start_at, entry.end_at, entry.mode,
            entry.target_min, entry.note
        ],
    )
    .str_err()?;
    Ok(())
}

#[tauri::command]
pub fn delete_time_entry(state: State<AppState>, id: String) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    db.execute("DELETE FROM time_entries WHERE id = ?1", [id]).str_err()?;
    Ok(())
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
    /// Extra metrics pulled from the source data (training effect, cadence,
    /// HR zones...). Computed on read; never written.
    #[serde(default, skip_deserializing)]
    pub extra: Option<serde_json::Value>,
}

/// Normalises the interesting fields of a Garmin summary or a FIT session
/// (stored as `raw`) into one flat object with stable names.
pub fn extract_extra(raw: &str) -> Option<serde_json::Value> {
    let v: serde_json::Value = serde_json::from_str(raw).ok()?;
    let num = |keys: &[&str]| keys.iter().find_map(|k| v.get(*k).and_then(|x| x.as_f64()));
    let mut m = serde_json::Map::new();
    let mut put = |name: &str, val: Option<f64>| {
        if let Some(x) = val {
            m.insert(name.into(), serde_json::json!(x));
        }
    };
    put("teAerobic", num(&["aerobicTrainingEffect", "total_training_effect"]));
    put("teAnaerobic", num(&["anaerobicTrainingEffect", "total_anaerobic_training_effect"]));
    put("trainingLoad", num(&["activityTrainingLoad"]));
    put("vo2max", num(&["vO2MaxValue"]));
    put("cadence", num(&["averageRunningCadenceInStepsPerMinute", "averageBikingCadenceInRevPerMinute", "avg_cadence"]));
    put("maxCadence", num(&["maxRunningCadenceInStepsPerMinute", "maxBikingCadenceInRevPerMinute", "max_cadence"]));
    put("avgSpeed", num(&["averageSpeed", "enhanced_avg_speed", "avg_speed"]));
    put("maxSpeed", num(&["maxSpeed", "enhanced_max_speed", "max_speed"]));
    put("movingS", num(&["movingDuration", "total_moving_time"]));
    put("elapsedS", num(&["elapsedDuration", "total_elapsed_time"]));
    put("descent", num(&["elevationLoss", "total_descent"]));
    put("minElev", num(&["minElevation", "enhanced_min_altitude", "min_altitude"]));
    put("maxElev", num(&["maxElevation", "enhanced_max_altitude", "max_altitude"]));
    put("steps", num(&["steps", "total_strides"]));
    put("stride", num(&["avgStrideLength"]));
    put("normPower", num(&["normPower", "normalized_power"]));
    put("maxPower", num(&["maxPower", "max_power"]));
    put("respiration", num(&["avgRespirationRate"]));
    put("tempMin", num(&["minTemperature", "min_temperature"]));
    put("tempMax", num(&["maxTemperature", "max_temperature"]));
    put("laps", num(&["lapCount", "num_laps"]));
    put("swolf", num(&["averageSwolf"]));
    put("lengths", num(&["activeLengths", "num_active_lengths"]));
    put("poolLength", num(&["poolLength", "pool_length"]));
    put("strokes", num(&["totalNumberOfStrokes", "total_strokes"]));
    put("vertOsc", num(&["avgVerticalOscillation"]));
    put("gct", num(&["avgGroundContactTime"]));
    put("bodyBatteryChange", num(&["differenceBodyBattery"]));
    let zones: Vec<f64> = (1..=5).filter_map(|i| v.get(format!("hrTimeInZone_{i}")).and_then(|x| x.as_f64())).collect();
    if zones.len() == 5 {
        m.insert("hrZones".into(), serde_json::json!(zones));
    }
    for (name, keys) in [("teLabel", ["trainingEffectLabel", ""]), ("location", ["locationName", ""]), ("description", ["description", ""])] {
        if let Some(s) = keys.iter().filter(|k| !k.is_empty()).find_map(|k| v.get(*k).and_then(|x| x.as_str())) {
            m.insert(name.into(), serde_json::json!(s));
        }
    }
    Some(serde_json::Value::Object(m))
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
               avg_power = excluded.avg_power, raw = COALESCE(excluded.raw, activities.raw)",
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
                    avg_hr, max_hr, elevation_m, calories, avg_power, raw
             FROM activities ORDER BY start_time DESC",
        )
        .str_err()?;
    let rows = stmt
        .query_map([], |r| {
            let raw: Option<String> = r.get(13)?;
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
                extra: raw.as_deref().and_then(extract_extra),
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
    db.execute("DELETE FROM activity_details WHERE activity_id = ?1", [&id]).str_err()?;
    db.execute("DELETE FROM activities WHERE id = ?1", [&id]).str_err()?;
    Ok(())
}

/// Time series + laps + zones for one activity, if stored.
/// Shape: { samples: { t, hr, speed, alt, cad, pwr, dist }, laps: [...], zones: [...] }
#[tauri::command]
pub fn get_activity_detail(state: State<AppState>, id: String) -> Result<Option<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    let data: Option<String> = db
        .query_row("SELECT data FROM activity_details WHERE activity_id = ?1", [&id], |r| r.get(0))
        .optional()
        .str_err()?;
    Ok(data.and_then(|d| serde_json::from_str(&d).ok()))
}

pub fn save_activity_detail(conn: &Connection, id: &str, data: &serde_json::Value) -> rusqlite::Result<()> {
    conn.execute(
        "INSERT OR REPLACE INTO activity_details (activity_id, data) VALUES (?1, ?2)",
        params![id, data.to_string()],
    )?;
    Ok(())
}

// ---------- daily metrics (sleep, HRV, resting HR, steps, weight...) ----------

/// Merges `patch` into the stored object for `date`.
pub fn merge_daily_metrics(conn: &Connection, date: &str, patch: &serde_json::Value) -> rusqlite::Result<()> {
    let cur: Option<String> = conn
        .query_row("SELECT data FROM daily_metrics WHERE date = ?1", [date], |r| r.get(0))
        .optional()?;
    let mut obj: serde_json::Map<String, serde_json::Value> =
        cur.and_then(|c| serde_json::from_str(&c).ok()).unwrap_or_default();
    if let Some(p) = patch.as_object() {
        for (k, v) in p {
            if v.is_null() {
                obj.remove(k);
            } else {
                obj.insert(k.clone(), v.clone());
            }
        }
    }
    conn.execute(
        "INSERT OR REPLACE INTO daily_metrics (date, data) VALUES (?1, ?2)",
        params![date, serde_json::Value::Object(obj).to_string()],
    )?;
    Ok(())
}

#[tauri::command]
pub fn list_daily_metrics(state: State<AppState>) -> Result<Vec<serde_json::Value>, String> {
    let db = state.db.lock().unwrap();
    let mut stmt = db.prepare("SELECT date, data FROM daily_metrics ORDER BY date").str_err()?;
    let rows = stmt
        .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))
        .str_err()?;
    let mut out = Vec::new();
    for row in rows {
        let (date, data) = row.str_err()?;
        let mut v: serde_json::Value = serde_json::from_str(&data).unwrap_or(serde_json::json!({}));
        v["date"] = serde_json::json!(date);
        out.push(v);
    }
    Ok(out)
}

/// Manual entries (e.g. body weight) from the UI.
#[tauri::command]
pub fn save_daily_metric(state: State<AppState>, date: String, patch: serde_json::Value) -> Result<(), String> {
    let db = state.db.lock().unwrap();
    merge_daily_metrics(&db, &date, &patch).str_err()
}

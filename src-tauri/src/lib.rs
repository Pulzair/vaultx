mod db;
mod fitness;
mod net;
mod vault;

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::Manager;

pub struct AppState {
    pub db: Mutex<rusqlite::Connection>,
    pub vault: Mutex<PathBuf>,
    pub garmin: Mutex<Option<fitness::GarminProc>>,
}

/// Commands return `Result<_, String>` so errors reach the UI as plain text.
pub trait StrErr<T> {
    fn str_err(self) -> Result<T, String>;
}
impl<T, E: std::fmt::Display> StrErr<T> for Result<T, E> {
    fn str_err(self) -> Result<T, String> {
        self.map_err(|e| e.to_string())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let conn = db::open(&data_dir.join("vaultx.db"))?;

            // The vault defaults to Documents/VaultX so files are easy to find
            // and back up; it can be moved from Settings.
            let vault = db::get_setting_conn(&conn, "vault_path")
                .map(PathBuf::from)
                .unwrap_or_else(|| {
                    app.path()
                        .document_dir()
                        .unwrap_or_else(|_| data_dir.clone())
                        .join("VaultX")
                });
            std::fs::create_dir_all(&vault)?;
            seed_vault(&vault);

            app.manage(AppState {
                db: Mutex::new(conn),
                vault: Mutex::new(vault),
                garmin: Mutex::new(None),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            db::get_settings,
            db::set_setting,
            db::list_lists,
            db::save_list,
            db::delete_list,
            db::list_tasks,
            db::save_task,
            db::delete_task,
            db::list_calendars,
            db::save_calendar,
            db::delete_calendar,
            db::replace_calendar_events,
            db::list_external_events,
            db::list_activities,
            db::save_activity,
            db::delete_activity,
            vault::vault_info,
            vault::set_vault_path,
            vault::list_notes,
            vault::read_note,
            vault::write_note,
            vault::rename_note,
            vault::trash_file,
            vault::list_sheets,
            vault::export_file,
            fitness::import_fit,
            fitness::garmin_status,
            fitness::garmin_setup,
            fitness::garmin_login,
            fitness::garmin_mfa,
            fitness::garmin_logout,
            fitness::garmin_sync,
            net::fetch_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running VaultX");
}

/// A first-run welcome note so the notes view and graph are not empty.
fn seed_vault(vault: &std::path::Path) {
    let welcome = vault.join("Welcome.md");
    let is_empty = std::fs::read_dir(vault).map(|mut d| d.next().is_none()).unwrap_or(false);
    if is_empty {
        let _ = std::fs::write(
            &welcome,
            "# Welcome to VaultX\n\nThis folder is your vault. Every note is a plain Markdown file you own.\n\n\
             - Link notes with double brackets, e.g. [[Ideas]] - missing notes are created when you open the link.\n\
             - The Graph view shows how notes connect.\n\
             - Spreadsheets are stored in `Sheets/`, exports in `Exports/`.\n",
        );
    }
}

//! Training data ingestion.
//!
//! * `.FIT` files (any device: Garmin, Wahoo, Coros, Suunto...) are parsed in
//!   Rust with `fitparser`; only the session summary is stored for now.
//! * Garmin Connect has no personal API keys, so we talk to it the same way
//!   the community `garminconnect` Python library does (account login, tokens
//!   cached locally). That library runs in a small helper process
//!   (`sidecar/garmin_bridge.py`) inside a private virtualenv the app creates.
//!   Protocol: one JSON object per line on stdin/stdout.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use serde_json::{json, Value as Json};
use tauri::{AppHandle, Manager, State};

use crate::db::{upsert_activities, Activity};
use crate::{AppState, StrErr};

// ---------- FIT import ----------

fn fit_f64(v: &fitparser::Value) -> Option<f64> {
    use fitparser::Value::*;
    match v {
        Float32(x) => Some(*x as f64),
        Float64(x) => Some(*x),
        UInt8(x) | UInt8z(x) | Byte(x) | Enum(x) => Some(*x as f64),
        UInt16(x) | UInt16z(x) => Some(*x as f64),
        UInt32(x) | UInt32z(x) => Some(*x as f64),
        UInt64(x) | UInt64z(x) => Some(*x as f64),
        SInt8(x) => Some(*x as f64),
        SInt16(x) => Some(*x as f64),
        SInt32(x) => Some(*x as f64),
        SInt64(x) => Some(*x as f64),
        _ => None,
    }
}

fn parse_fit(name: &str, bytes: &[u8]) -> Result<Vec<Activity>, String> {
    let records = fitparser::from_bytes(bytes).map_err(|e| format!("{name}: {e}"))?;
    let mut out = Vec::new();
    for rec in records.iter().filter(|r| r.kind() == fitparser::profile::MesgNum::Session) {
        let mut a = Activity {
            id: uuid::Uuid::new_v4().to_string(),
            source: "fit".into(),
            external_id: String::new(),
            sport: "other".into(),
            name: name.trim_end_matches(".fit").trim_end_matches(".FIT").to_string(),
            start_time: String::new(),
            duration_s: 0.0,
            distance_m: None,
            avg_hr: None,
            max_hr: None,
            elevation_m: None,
            calories: None,
            avg_power: None,
        };
        let mut sub_sport = String::new();
        for f in rec.fields() {
            let v = f.value();
            match f.name() {
                "start_time" => {
                    if let fitparser::Value::Timestamp(t) = v {
                        a.start_time = t.format("%Y-%m-%dT%H:%M:%S").to_string();
                    }
                }
                "sport" => a.sport = v.to_string(),
                "sub_sport" => sub_sport = v.to_string(),
                "total_timer_time" => a.duration_s = fit_f64(v).unwrap_or(0.0),
                "total_distance" => a.distance_m = fit_f64(v),
                "avg_heart_rate" => a.avg_hr = fit_f64(v),
                "max_heart_rate" => a.max_hr = fit_f64(v),
                "total_ascent" => a.elevation_m = fit_f64(v),
                "total_calories" => a.calories = fit_f64(v),
                "avg_power" => a.avg_power = fit_f64(v),
                _ => {}
            }
        }
        if !sub_sport.is_empty() && sub_sport != "generic" {
            a.sport = format!("{}_{}", a.sport, sub_sport);
        }
        // Same file imported twice should update, not duplicate.
        a.external_id = format!("{}#{}", a.start_time, a.sport);
        if !a.start_time.is_empty() {
            out.push(a);
        }
    }
    if out.is_empty() {
        return Err(format!("{name}: no activity session found in file"));
    }
    Ok(out)
}

#[tauri::command]
pub fn import_fit(state: State<AppState>, name: String, bytes: Vec<u8>) -> Result<usize, String> {
    let acts = parse_fit(&name, &bytes)?;
    let raw = vec![None; acts.len()];
    let mut db = state.db.lock().unwrap();
    upsert_activities(&mut db, &acts, &raw).str_err()
}

// ---------- Garmin bridge ----------

pub struct GarminProc {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl GarminProc {
    fn call(&mut self, msg: Json) -> Result<Json, String> {
        writeln!(self.stdin, "{msg}").str_err()?;
        self.stdin.flush().str_err()?;
        let mut line = String::new();
        if self.stdout.read_line(&mut line).str_err()? == 0 {
            return Err("Garmin helper exited unexpectedly".into());
        }
        let resp: Json = serde_json::from_str(&line).map_err(|e| format!("bad helper reply: {e}: {line}"))?;
        if let Some(err) = resp.get("error").and_then(|e| e.as_str()) {
            return Err(err.to_string());
        }
        Ok(resp)
    }
}

impl Drop for GarminProc {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

fn garmin_dirs(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let data = app.state::<AppState>().data_dir.clone();
    Ok((data.join("garmin-venv"), data.join("garmin-tokens")))
}

fn venv_python(venv: &PathBuf) -> PathBuf {
    if cfg!(windows) {
        venv.join("Scripts").join("python.exe")
    } else {
        venv.join("bin").join("python")
    }
}

fn bridge_script(app: &AppHandle) -> Result<PathBuf, String> {
    // Bundled as a resource; in dev builds fall back to the source tree.
    if let Ok(p) = app.path().resolve("sidecar/garmin_bridge.py", tauri::path::BaseDirectory::Resource) {
        if p.exists() {
            return Ok(p);
        }
    }
    let dev = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("sidecar").join("garmin_bridge.py");
    if dev.exists() {
        Ok(dev)
    } else {
        Err("garmin_bridge.py not found".into())
    }
}

fn hidden(cmd: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    cmd
}

/// Is the helper environment installed, and are login tokens cached?
#[tauri::command]
pub fn garmin_status(app: AppHandle) -> Result<Json, String> {
    let (venv, tokens) = garmin_dirs(&app)?;
    Ok(json!({
        "installed": venv_python(&venv).exists(),
        "hasTokens": tokens.exists() && tokens.read_dir().map(|mut d| d.next().is_some()).unwrap_or(false),
    }))
}

/// Creates the private virtualenv and installs `garminconnect` into it.
#[tauri::command]
pub async fn garmin_setup(app: AppHandle, python: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (venv, _) = garmin_dirs(&app)?;
        let base_python = python.filter(|p| !p.trim().is_empty()).unwrap_or_else(|| {
            if cfg!(windows) { "python".into() } else { "python3".into() }
        });
        let out = hidden(Command::new(&base_python).arg("-m").arg("venv").arg(&venv))
            .output()
            .map_err(|e| format!("Could not run '{base_python}'. Is Python 3 installed? ({e})"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
        let req = bridge_script(&app)?.with_file_name("requirements.txt");
        let out = hidden(
            Command::new(venv_python(&venv))
                .args(["-m", "pip", "install", "--disable-pip-version-check", "-r"])
                .arg(req),
        )
        .output()
        .str_err()?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).to_string());
        }
        Ok("Garmin helper installed".to_string())
    })
    .await
    .str_err()?
}

fn with_bridge<T>(
    app: &AppHandle,
    state: &State<AppState>,
    f: impl FnOnce(&mut GarminProc) -> Result<T, String>,
) -> Result<T, String> {
    let mut guard = state.garmin.lock().unwrap();
    if guard.is_none() {
        let (venv, tokens) = garmin_dirs(app)?;
        let py = venv_python(&venv);
        if !py.exists() {
            return Err("Garmin helper is not installed yet".into());
        }
        let mut child = hidden(
            Command::new(py)
                .arg("-u")
                .arg(bridge_script(app)?)
                .arg(&tokens)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null()),
        )
        .spawn()
        .str_err()?;
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        *guard = Some(GarminProc { child, stdin, stdout });
    }
    let result = f(guard.as_mut().unwrap());
    if result.is_err() {
        // A broken helper is restarted on the next call.
        if let Some(p) = guard.as_mut() {
            if p.child.try_wait().ok().flatten().is_some() {
                *guard = None;
            }
        }
    }
    result
}

/// Logs in with the user's Garmin account. Returns `{ "mfa": true }` when a
/// one-time code is needed; send it with `garmin_mfa`.
#[tauri::command]
pub async fn garmin_login(app: AppHandle, email: String, password: String) -> Result<Json, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_bridge(&app, &state, |p| p.call(json!({"cmd": "login", "email": email, "password": password})))
    })
    .await
    .str_err()?
}

#[tauri::command]
pub async fn garmin_mfa(app: AppHandle, code: String) -> Result<Json, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        with_bridge(&app, &state, |p| p.call(json!({"cmd": "mfa", "code": code})))
    })
    .await
    .str_err()?
}

#[tauri::command]
pub async fn garmin_logout(app: AppHandle) -> Result<(), String> {
    let (_, tokens) = garmin_dirs(&app)?;
    *app.state::<AppState>().garmin.lock().unwrap() = None;
    if tokens.exists() {
        std::fs::remove_dir_all(tokens).str_err()?;
    }
    Ok(())
}

fn garmin_to_activity(v: &Json) -> Option<Activity> {
    let f = |k: &str| v.get(k).and_then(|x| x.as_f64());
    let id = v.get("activityId")?.to_string();
    let start = v.get("startTimeLocal")?.as_str()?.replace(' ', "T");
    Some(Activity {
        id: format!("garmin-{id}"),
        source: "garmin".into(),
        external_id: id,
        sport: v
            .pointer("/activityType/typeKey")
            .and_then(|x| x.as_str())
            .unwrap_or("other")
            .to_string(),
        name: v.get("activityName").and_then(|x| x.as_str()).unwrap_or("").to_string(),
        start_time: start.chars().take(19).collect(),
        duration_s: f("duration").unwrap_or(0.0),
        distance_m: f("distance"),
        avg_hr: f("averageHR"),
        max_hr: f("maxHR"),
        elevation_m: f("elevationGain"),
        calories: f("calories"),
        avg_power: f("avgPower"),
    })
}

/// Pulls the last `days` days of activities from Garmin Connect into the DB.
#[tauri::command]
pub async fn garmin_sync(app: AppHandle, days: u32) -> Result<usize, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let resp = with_bridge(&app, &state, |p| p.call(json!({"cmd": "sync", "days": days})))?;
        let list = resp.get("activities").and_then(|a| a.as_array()).cloned().unwrap_or_default();
        let mut acts = Vec::new();
        let mut raw = Vec::new();
        for v in &list {
            if let Some(a) = garmin_to_activity(v) {
                acts.push(a);
                raw.push(Some(v.to_string()));
            }
        }
        let mut db = state.db.lock().unwrap();
        upsert_activities(&mut db, &acts, &raw).str_err()?;
        Ok(acts.len())
    })
    .await
    .str_err()?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_garmin_activity() {
        let v = json!({
            "activityId": 123, "activityName": "Morning Run",
            "startTimeLocal": "2026-11-01 07:15:00",
            "activityType": {"typeKey": "running"},
            "duration": 1800.5, "distance": 5000.0, "averageHR": 150.0
        });
        let a = garmin_to_activity(&v).unwrap();
        assert_eq!(a.external_id, "123");
        assert_eq!(a.start_time, "2026-11-01T07:15:00");
        assert_eq!(a.sport, "running");
        assert_eq!(a.avg_hr, Some(150.0));
    }
}

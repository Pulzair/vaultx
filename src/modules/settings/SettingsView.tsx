import { useEffect, useRef, useState } from "react";
import { api, errText } from "../../lib/api";
import { askConfirm } from "../../lib/dialog";
import type { NoiseKind } from "../../lib/noise";
import type { TimeStore } from "../../lib/timeStore";
import { toast, toastError } from "../../lib/toast";

const CSV_TABLES = [
  ["tasks", "Tasks"], ["lists", "Lists"], ["time_entries", "Time entries"], ["habits", "Habits"], ["habit_checkins", "Habit check-ins"],
  ["activities", "Activities"], ["daily_metrics", "Wellness (daily)"], ["docs", "Diet + other documents"],
];

type ApiState = { enabled: boolean; port: number; token: string; running: boolean };

export default function SettingsView({ onVaultChange, time }: { onVaultChange: (p: string) => void; time: TimeStore }) {
  const [vault, setVault] = useState("");
  const [theme, setTheme] = useState("system");
  const [apiState, setApiState] = useState<ApiState | null>(null);
  const [port, setPort] = useState(47821);
  const [showToken, setShowToken] = useState(false);
  const [overwrite, setOverwrite] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const fs = time.settings;

  useEffect(() => {
    api.vaultInfo().then((v) => setVault(v.path));
    api.getSettings().then((s) => setTheme(s.theme || "system"));
    api.apiStatus().then((s) => { setApiState(s); setPort(s.port); }).catch(() => {});
  }, []);

  const applyTheme = (t: string) => {
    setTheme(t);
    if (t === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = t;
    api.setSetting("theme", t === "system" ? "" : t);
  };

  const moveVault = async () => {
    try {
      await api.setVaultPath(vault);
      onVaultChange(vault);
      toast("Vault folder changed. Existing files are not moved - copy them over if needed.");
    } catch (e) {
      toastError(e);
    }
  };

  const backup = async () => {
    try {
      const p = await api.exportAll();
      toast(`Backup written to ${p}`);
    } catch (e) { toastError(e); }
  };

  const restore = async (f: File) => {
    if (!(await askConfirm(`Import "${f.name}"? Matching records are replaced by the file's version; a backup of your current data is saved first.`, "Import"))) return;
    try {
      const r = await api.importAll(await f.text(), overwrite);
      const rows = Object.values(r.rows).reduce((a, b) => a + b, 0);
      toast(`Imported ${rows} records and ${r.filesWritten} files (${r.filesSkipped} existing files kept) from VaultX ${r.fromVersion}. Restart VaultX to see everything.`, "info", undefined, 10000);
    } catch (e) {
      toastError(errText(e));
    }
  };

  const configureApi = async (enabled: boolean, newToken = false) => {
    try {
      const s = await api.apiConfigure(enabled, port, newToken);
      setApiState(s);
      toast(enabled ? `Local API on http://127.0.0.1:${s.port}` : "Local API off");
    } catch (e) { toastError(e); }
  };

  const base = apiState ? `http://127.0.0.1:${apiState.port}/api/v1` : "";

  return (
    <>
      <div className="bar"><h1>Settings</h1></div>
      <div className="scroll settings">
        <section>
          <h2>General</h2>
          <div className="field">
            <span className="label">Vault folder</span>
            <div className="row">
              <input className="input mono" style={{ flex: 1, fontSize: 12 }} value={vault} onChange={(e) => setVault(e.target.value)} />
              <button className="btn" onClick={moveVault}>Use folder</button>
            </div>
            <span className="muted" style={{ fontSize: 12 }}>
              Notes (.md / .txt) and spreadsheets live here as plain files. Point it at an existing Obsidian vault if you have one.
              Tasks, calendars, habits, diet and training data are kept in a local SQLite database in the app data folder.
            </span>
          </div>
          <div className="field">
            <span className="label">Theme</span>
            <div className="seg" style={{ justifySelf: "start" }}>
              {["system", "light", "dark"].map((t) => (
                <button key={t} aria-pressed={theme === t} onClick={() => applyTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
          </div>
          <div className="field">
            <span className="label">Keyboard</span>
            <span className="muted mono" style={{ fontSize: 12 }}>Ctrl+K search and commands · Ctrl+1..9 switch modules · Ctrl+, settings</span>
          </div>
        </section>

        <section>
          <h2>Focus</h2>
          <div className="settings-grid">
            {([["pomoMin", "Pomodoro (min)"], ["breakMin", "Short break (min)"], ["longBreakMin", "Long break (min)"], ["longEvery", "Long break every N"], ["dailyGoalMin", "Daily focus goal (min)"]] as const).map(([k, label]) => (
              <label key={k} className="field"><span className="label">{label}</span>
                <input className="input num" type="number" min={0} value={fs[k]} onChange={(e) => time.setSettings({ [k]: Math.max(0, Number(e.target.value) || 0) })} />
              </label>
            ))}
            <label className="field"><span className="label">Background noise</span>
              <select className="select" value={fs.noise} onChange={(e) => time.setSettings({ noise: e.target.value as NoiseKind })}>
                <option value="off">Off</option><option value="pink">Pink (soft)</option><option value="brown">Brown (deep)</option><option value="white">White</option>
              </select>
            </label>
          </div>
          <label className="row" style={{ fontSize: 12.5 }}>
            <input type="checkbox" checked={fs.autoBreak} onChange={(e) => time.setSettings({ autoBreak: e.target.checked })} />
            Start a break automatically when a pomodoro ends
          </label>
        </section>

        <section>
          <h2>Data</h2>
          <p className="muted">Everything stays on this computer. Back up or move your data with one file - it works across VaultX versions (older backups import into newer versions and missing fields are filled in).</p>
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button className="btn primary" onClick={backup}>Back up everything</button>
            <button className="btn" onClick={() => fileInput.current?.click()}>Import a backup...</button>
            <label className="row muted" style={{ fontSize: 12 }}>
              <input type="checkbox" checked={overwrite} onChange={(e) => setOverwrite(e.target.checked)} /> overwrite notes that already exist
            </label>
            <input ref={fileInput} type="file" accept=".json,application/json" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f) restore(f); e.target.value = ""; }} />
          </div>
          <span className="muted" style={{ fontSize: 12 }}>Backups go to the vault's Exports folder as <span className="mono">vaultx-backup-*.json</span>. Importing first saves a <span className="mono">pre-import-backup</span> there too.</span>
          <div className="label" style={{ marginTop: 12 }}>Spreadsheet export (CSV)</div>
          <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
            {CSV_TABLES.map(([t, label]) => (
              <button key={t} className="btn ghost" onClick={() => api.exportCsv(t).then((p) => toast(`Saved ${p}`)).catch(toastError)}>{label}</button>
            ))}
          </div>
        </section>

        <section>
          <h2>Local API</h2>
          <p className="muted">
            A read-only HTTP endpoint on this computer only (127.0.0.1), so scripts, dashboards or other apps can read your VaultX data.
            Every request needs the token. Nothing is reachable from other devices.
          </p>
          {apiState && (
            <>
              <div className="row">
                <label className="row"><input type="checkbox" checked={apiState.enabled} onChange={(e) => configureApi(e.target.checked)} /> Enable</label>
                <span className="label" style={{ marginLeft: 16 }}>Port</span>
                <input className="input num" type="number" style={{ width: 80 }} value={port} onChange={(e) => setPort(Number(e.target.value) || 47821)} />
                {apiState.enabled && <button className="btn ghost" onClick={() => configureApi(true)}>Apply</button>}
                <span className={`mono ${apiState.running ? "" : "muted"}`} style={{ fontSize: 12 }}>{apiState.running ? "running" : "stopped"}</span>
              </div>
              <div className="row">
                <span className="label" style={{ width: 50 }}>Token</span>
                <code className="code">{showToken ? apiState.token : "•".repeat(16)}</code>
                <button className="btn ghost tiny" onClick={() => setShowToken(!showToken)}>{showToken ? "hide" : "show"}</button>
                <button className="btn ghost tiny" onClick={() => navigator.clipboard.writeText(apiState.token).then(() => toast("Token copied"))}>copy</button>
                <button className="btn ghost tiny danger" onClick={() => configureApi(apiState.enabled, true)}>new token</button>
              </div>
              <pre className="code-block">{`curl -H "Authorization: Bearer <token>" ${base}/health
GET ${base}/export            full backup JSON
GET ${base}/tasks             any table: tasks, lists, time_entries, habits,
                              habit_checkins, activities, daily_metrics...
GET ${base}/docs/food_logs    diet log (also foods, diet_days, filters)
GET ${base}/notes             note paths;  /notes/<path> for content`}</pre>
            </>
          )}
        </section>

        <section>
          <h2>About</h2>
          <span className="muted" style={{ fontSize: 12 }}>VaultX {__APP_VERSION__}. Open source under the MIT licence. All data stays on this computer.</span>
        </section>
      </div>
    </>
  );
}

import { useEffect, useState } from "react";
import { api, errText } from "../../lib/api";

export default function SettingsView({ onVaultChange }: { onVaultChange: (p: string) => void }) {
  const [vault, setVault] = useState("");
  const [theme, setTheme] = useState("system");
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.vaultInfo().then((v) => setVault(v.path));
    api.getSettings().then((s) => setTheme(s.theme ?? "system"));
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
      setMsg("Vault folder changed. Existing files are not moved - copy them over if needed.");
    } catch (e) {
      setMsg(errText(e));
    }
  };

  return (
    <>
      <div className="bar"><h1>Settings</h1></div>
      <div className="scroll" style={{ padding: "18px 22px", maxWidth: 680 }}>
        <div className="field">
          <span className="label">Vault folder</span>
          <div className="row">
            <input className="input mono" style={{ flex: 1, fontSize: 12 }} value={vault} onChange={(e) => setVault(e.target.value)} />
            <button className="btn" onClick={moveVault}>Use folder</button>
          </div>
          <span className="muted" style={{ fontSize: 12 }}>
            Notes (.md / .txt) and spreadsheets live here as plain files. Point it at an existing Obsidian vault if you have one.
            Tasks, calendars and training data are kept in a local SQLite database in the app data folder.
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
          <span className="muted mono" style={{ fontSize: 12 }}>Ctrl+1..6 switch modules · Ctrl+, settings</span>
        </div>
        {msg && <div className="error-line" style={{ padding: 0, color: "var(--ink-2)" }}>{msg}</div>}
        <div className="field" style={{ marginTop: 24 }}>
          <span className="label">About</span>
          <span className="muted" style={{ fontSize: 12 }}>VaultX 0.0.1 (draft 0). Open source under the MIT licence. All data stays on this computer.</span>
        </div>
      </div>
    </>
  );
}

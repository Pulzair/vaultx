import { useEffect, useState } from "react";
import { api } from "./lib/api";
import { useTaskStore } from "./lib/taskStore";
import { useTimeStore } from "./lib/timeStore";
import TimerWidget from "./components/TimerWidget";
import NotesView from "./modules/notes/NotesView";
import TasksView from "./modules/tasks/TasksView";
import CalendarView from "./modules/calendar/CalendarView";
import SheetsView from "./modules/sheets/SheetsView";
import FitnessView from "./modules/fitness/FitnessView";
import DigestView from "./modules/digest/DigestView";
import SettingsView from "./modules/settings/SettingsView";

const MODULES = [
  { id: "notes", label: "Notes" },
  { id: "tasks", label: "Tasks" },
  { id: "calendar", label: "Calendar" },
  { id: "sheets", label: "Sheets" },
  { id: "training", label: "Training" },
  { id: "digest", label: "Digest" },
] as const;

type ModuleId = (typeof MODULES)[number]["id"] | "settings";

export default function App() {
  const [active, setActive] = useState<ModuleId>("notes");
  const [vaultPath, setVaultPath] = useState("");
  const taskStore = useTaskStore();
  const timeStore = useTimeStore();

  useEffect(() => {
    api.vaultInfo().then((v) => setVaultPath(v.path)).catch(() => {});
    api.getSettings().then((s) => {
      if (s.theme) document.documentElement.dataset.theme = s.theme;
    }).catch(() => {});
  }, []);

  // Ctrl/Cmd + 1..6 switches modules.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= MODULES.length) {
        e.preventDefault();
        setActive(MODULES[n - 1].id);
      }
      if (e.key === ",") {
        e.preventDefault();
        setActive("settings");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="shell">
      <aside className="rail">
        <div className="wordmark">
          VAULT<span>X</span>
        </div>
        <nav>
          {MODULES.map((m, i) => (
            <button
              key={m.id}
              aria-current={active === m.id ? "page" : undefined}
              onClick={() => setActive(m.id)}
            >
              {m.label}
              <kbd>^{i + 1}</kbd>
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <TimerWidget store={timeStore} />
        <nav>
          <button aria-current={active === "settings" ? "page" : undefined} onClick={() => setActive("settings")}>
            Settings <kbd>^,</kbd>
          </button>
        </nav>
        <div className="vault-path" title="Vault folder">{vaultPath}</div>
      </aside>
      <main className="main">
        {active === "notes" && <NotesView />}
        {active === "tasks" && <TasksView store={taskStore} time={timeStore} />}
        {active === "calendar" && <CalendarView store={taskStore} time={timeStore} />}
        {active === "sheets" && <SheetsView />}
        {active === "training" && <FitnessView />}
        {active === "digest" && <DigestView />}
        {active === "settings" && <SettingsView onVaultChange={setVaultPath} />}
      </main>
    </div>
  );
}

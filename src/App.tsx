import { useCallback, useEffect, useState } from "react";
import { api } from "./lib/api";
import { useDietStore } from "./lib/diet";
import { useHabitStore } from "./lib/habits";
import { useReminders } from "./lib/reminders";
import { useTaskStore } from "./lib/taskStore";
import { useTimeStore } from "./lib/timeStore";
import TimerWidget from "./components/TimerWidget";
import Palette from "./components/Palette";
import Toasts from "./components/Toasts";
import NotesView from "./modules/notes/NotesView";
import TasksView from "./modules/tasks/TasksView";
import CalendarView from "./modules/calendar/CalendarView";
import TimeView from "./modules/time/TimeView";
import HabitsView from "./modules/habits/HabitsView";
import DietView from "./modules/diet/DietView";
import SheetsView from "./modules/sheets/SheetsView";
import FitnessView from "./modules/fitness/FitnessView";
import DigestView from "./modules/digest/DigestView";
import SettingsView from "./modules/settings/SettingsView";
import "./components/menu.css";

const MODULES = [
  { id: "notes", label: "Notes" },
  { id: "tasks", label: "Tasks" },
  { id: "calendar", label: "Calendar" },
  { id: "time", label: "Time" },
  { id: "habits", label: "Habits" },
  { id: "diet", label: "Diet" },
  { id: "training", label: "Training" },
  { id: "sheets", label: "Sheets" },
  { id: "digest", label: "Digest" },
] as const;

type ModuleId = (typeof MODULES)[number]["id"] | "settings";

export default function App() {
  const [active, setActive] = useState<ModuleId>("tasks");
  const [vaultPath, setVaultPath] = useState("");
  const [palette, setPalette] = useState(false);
  const [openNote, setOpenNote] = useState<string | null>(null);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const taskStore = useTaskStore();
  const timeStore = useTimeStore();
  const habitStore = useHabitStore();
  const dietStore = useDietStore();
  useReminders(taskStore.tasks, habitStore);

  useEffect(() => {
    api.vaultInfo().then((v) => setVaultPath(v.path)).catch(() => {});
    api.getSettings().then((s) => {
      if (s.theme) document.documentElement.dataset.theme = s.theme;
      if (s.last_module && MODULES.some((m) => m.id === s.last_module)) setActive(s.last_module as ModuleId);
    }).catch(() => {});
  }, []);

  const go = useCallback((target: string) => {
    const [mod, arg] = target.split(/:(.*)/s);
    if (mod === "notes" && arg) setOpenNote(arg);
    if (mod === "tasks" && arg) setOpenTask(arg);
    setActive(mod as ModuleId);
    if (mod !== "settings") api.setSetting("last_module", mod).catch(() => {});
  }, []);

  // Ctrl/Cmd + 1..9 switches modules, Ctrl+K opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const n = Number(e.key);
      if (n >= 1 && n <= MODULES.length) {
        e.preventDefault();
        go(MODULES[n - 1].id);
      }
      if (e.key === ",") { e.preventDefault(); go("settings"); }
      if (e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="shell">
      <aside className="rail">
        <div className="wordmark">
          VAULT<span>X</span>
        </div>
        <button className="search-btn" onClick={() => setPalette(true)}>Search <kbd>^K</kbd></button>
        <nav>
          {MODULES.map((m, i) => (
            <button key={m.id} aria-current={active === m.id ? "page" : undefined} onClick={() => go(m.id)}>
              {m.label}
              <kbd>^{i + 1}</kbd>
            </button>
          ))}
        </nav>
        <div className="spacer" />
        <TimerWidget store={timeStore} onOpenStats={() => go("time")} />
        <nav>
          <button aria-current={active === "settings" ? "page" : undefined} onClick={() => go("settings")}>
            Settings <kbd>^,</kbd>
          </button>
        </nav>
        <div className="vault-path" title="Vault folder">{vaultPath}</div>
      </aside>
      <main className="main">
        {active === "notes" && <NotesView openPath={openNote} onOpened={() => setOpenNote(null)} />}
        {active === "tasks" && <TasksView store={taskStore} time={timeStore} openTaskId={openTask} onOpened={() => setOpenTask(null)} />}
        {active === "calendar" && <CalendarView store={taskStore} time={timeStore} />}
        {active === "time" && <TimeView time={timeStore} tasks={taskStore} />}
        {active === "habits" && <HabitsView store={habitStore} />}
        {active === "diet" && <DietView store={dietStore} />}
        {active === "training" && <FitnessView />}
        {active === "sheets" && <SheetsView />}
        {active === "digest" && <DigestView />}
        {active === "settings" && <SettingsView onVaultChange={setVaultPath} time={timeStore} />}
      </main>
      {palette && <Palette onClose={() => setPalette(false)} tasks={taskStore} time={timeStore} go={go} modules={[...MODULES]} />}
      <Toasts />
    </div>
  );
}

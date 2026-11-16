// In-memory stand-in for the Rust commands, used ONLY when the UI is opened in
// a plain browser during development (`npm run dev` -> http://localhost:1420).
// Lets you click through the UI without the desktop shell. Data resets on reload.
// Never bundled into the desktop app: main.tsx imports it behind a DEV + !Tauri check.
import { mockIPC } from "@tauri-apps/api/mocks";

type Row = Record<string, unknown> & { id: string };

export function installMockBackend() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const dstr = (offset: number) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  const day = (offset: number, h: number, m = 0) => `${dstr(offset)}T${pad(h)}:${pad(m)}`;
  const iso = now.toISOString();
  const task = (p: Partial<Row> & { id: string; title: string }): Row => ({
    listId: "inbox", note: "", tags: [], priority: 0, dueDate: null, startAt: null, endAt: null, done: false, completedAt: null,
    createdAt: iso, updatedAt: iso, sort: 1, checklist: [], recurrence: null, reminders: [], wontDo: false, pinned: false,
    section: "", estimatePomos: 0, deletedAt: null, ...p,
  });

  const settings: Record<string, string> = { tag_colors: JSON.stringify({ maths: "#2a78d6" }) };
  const lists: Row[] = [
    { id: "inbox", name: "Inbox", color: "", sort: 0, folder: "", archived: false, view: "list", sections: [] },
    { id: "school", name: "School", color: "#2a78d6", sort: 1, folder: "Study", archived: false, view: "list", sections: [] },
    { id: "project", name: "VaultX", color: "#eb6834", sort: 2, folder: "", archived: false, view: "kanban", sections: ["Backlog", "Doing", "Done"] },
  ];
  const tasks: Row[] = [
    task({ id: "t1", listId: "school", title: "Maths homework", note: "Chapter 4 exercises", tags: ["maths"], priority: 2,
      dueDate: dstr(0), startAt: day(0, 13), endAt: day(0, 15), reminders: [15], estimatePomos: 3,
      checklist: [{ id: "c1", title: "Q1-5", done: true }, { id: "c2", title: "Q6-10", done: false }] }),
    task({ id: "t2", title: "Plan long run route", dueDate: dstr(1), recurrence: { freq: "weekly", interval: 1, byDay: [6] } }),
    task({ id: "t3", listId: "project", title: "Design habit stats", section: "Doing", priority: 3 }),
    task({ id: "t4", listId: "project", title: "Write release notes", section: "Backlog" }),
    task({ id: "t5", listId: "school", title: "Read chapter 5", done: true, completedAt: iso, dueDate: dstr(-1) }),
  ];
  const timeEntries: Row[] = [
    { id: "e1", taskId: "t1", title: "Maths homework", startAt: day(0, 13, 10) + ":00", endAt: day(0, 14, 5) + ":00", mode: "pomodoro", targetMin: 25, note: "" },
    { id: "e2", taskId: "t3", title: "Design habit stats", startAt: day(-1, 9) + ":00", endAt: day(-1, 10, 40) + ":00", mode: "stopwatch", targetMin: null, note: "sketches" },
    { id: "e3", taskId: "t1", title: "Maths homework", startAt: day(-2, 16) + ":00", endAt: day(-2, 16, 25) + ":00", mode: "pomodoro", targetMin: 25, note: "" },
  ];
  // A run with synthetic streams so the detail charts have something to draw.
  const n = 300;
  const t = Array.from({ length: n }, (_, i) => i * 10);
  const detail = {
    samples: {
      t,
      hr: t.map((s) => Math.round(120 + 30 * Math.min(1, s / 600) + 6 * Math.sin(s / 200))),
      speed: t.map((s) => +(3.1 + 0.25 * Math.sin(s / 300)).toFixed(2)),
      alt: t.map((s) => Math.round(40 + 15 * Math.sin(s / 500))),
      cad: t.map(() => 168 + Math.round(Math.random() * 6)),
    },
    laps: [1, 2, 3].map((i) => ({ durationS: 990, distanceM: 3030, avgHr: 140 + i * 4, maxHr: 160 + i * 3, avgSpeed: 3.06, ascentM: 20 })),
  };
  const activities: Row[] = [
    { id: "a1", source: "garmin", externalId: "1", sport: "running", name: "Morning Run", startTime: day(0, 7) + ":00",
      durationS: 2990, distanceM: 9100, avgHr: 148, maxHr: 171, elevationM: 64, calories: 610, avgPower: null,
      extra: { teAerobic: 3.4, teAnaerobic: 0.8, teLabel: "AEROBIC_BASE", trainingLoad: 96, vo2max: 52, cadence: 170, hrZones: [300, 900, 1200, 450, 140], movingS: 2950 } },
    { id: "a2", source: "manual", externalId: "2", sport: "kayaking", name: "Lake paddle", startTime: day(-2, 17, 30) + ":00",
      durationS: 4200, distanceM: 11000, avgHr: 128, maxHr: 150, elevationM: null, calories: 520, avgPower: null },
    { id: "a3", source: "fit", externalId: "3", sport: "cycling", name: "Hill ride", startTime: day(-4, 10) + ":00",
      durationS: 7200, distanceM: 52000, avgHr: 138, maxHr: 176, elevationM: 820, calories: 1400, avgPower: 182 },
  ];
  const details: Record<string, unknown> = { a1: detail };
  const daily: Row[] = Array.from({ length: 30 }, (_, i) => ({
    id: dstr(-i), date: dstr(-i), restingHr: 48 + Math.round(Math.random() * 4), hrv: 60 + Math.round(Math.random() * 15), hrvWeekly: 66,
    sleepS: 25200 + Math.round(Math.random() * 3600), sleepScore: 70 + Math.round(Math.random() * 20), steps: 6000 + Math.round(Math.random() * 8000),
    stressAvg: 25 + Math.round(Math.random() * 15), bodyBatteryHigh: 70 + Math.round(Math.random() * 25), bodyBatteryLow: 15 + Math.round(Math.random() * 15),
    ...(i % 3 === 0 ? { weightKg: +(72 - i * 0.03).toFixed(1) } : {}),
  }));
  const habits: Row[] = [
    { id: "h1", name: "Drink water", color: "#2a78d6", frequency: { type: "daily" }, goal: 8, unit: "glasses", section: "any", reminder: null, archived: false, sort: 1, createdAt: `${dstr(-20)}T08:00:00Z` },
    { id: "h2", name: "Stretch", color: "#1baf7a", frequency: { type: "daily" }, goal: 1, unit: "", section: "morning", reminder: "07:30", archived: false, sort: 2, createdAt: `${dstr(-20)}T08:00:00Z` },
  ];
  const checkins: { habitId: string; date: string; value: number }[] = [];
  for (let i = 1; i < 12; i++) checkins.push({ habitId: "h2", date: dstr(-i), value: 1 }, { habitId: "h1", date: dstr(-i), value: 5 + (i % 4) });
  const docs: Record<string, Row[]> = {
    foods: [
      { id: "f1", name: "Oats", brand: "", serving: "60 g", kcal: 228, protein: 8, carbs: 40, fat: 4, fiber: 6, favorite: true },
      { id: "f2", name: "Banana", brand: "", serving: "1 medium", kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, fiber: 3, favorite: false },
      { id: "f3", name: "Chicken breast", brand: "", serving: "150 g", kcal: 248, protein: 46, carbs: 0, fat: 5, fiber: 0, favorite: false },
    ],
    food_logs: [
      { id: "l1", date: dstr(0), meal: "breakfast", foodId: "f1", name: "Oats", servings: 1, kcal: 228, protein: 8, carbs: 40, fat: 4, fiber: 6, time: "07:40" },
      { id: "l2", date: dstr(0), meal: "breakfast", foodId: "f2", name: "Banana", servings: 1, kcal: 105, protein: 1.3, carbs: 27, fat: 0.4, fiber: 3, time: "07:41" },
    ],
    diet_days: [{ id: dstr(0), waterMl: 750, note: "" }],
    filters: [],
  };
  const notes: Record<string, string> = { "Welcome.md": "# Welcome\n\nMock vault. See [[Ideas]].\n", "Ideas.md": "# Ideas\n\nBack to [[Welcome]].\n" };

  const upsert = (arr: Row[], row: Row) => {
    const i = arr.findIndex((r) => r.id === row.id);
    if (i < 0) arr.push(row); else arr[i] = row;
  };
  const del = (arr: Row[], id: string) => {
    const i = arr.findIndex((r) => r.id === id);
    if (i >= 0) arr.splice(i, 1);
  };
  const linksOf = (s: string) => [...s.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());
  let apiState = { enabled: false, port: 47821, token: "mock-token-not-real", running: false };

  mockIPC((cmd, args) => {
    const a = (args ?? {}) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (cmd) {
      case "get_settings": return { ...settings };
      case "set_setting": settings[a.key] = a.value; return null;
      case "list_lists": return lists;
      case "save_list": upsert(lists, a.list); return null;
      case "delete_list": del(lists, a.id); return null;
      case "list_tasks": return tasks;
      case "save_task": upsert(tasks, a.task); return null;
      case "delete_task": del(tasks, a.id); return null;
      case "list_habits": return habits;
      case "save_habit": upsert(habits, a.habit); return null;
      case "delete_habit": del(habits, a.id); return null;
      case "list_checkins": return checkins;
      case "set_checkin": {
        const i = checkins.findIndex((c) => c.habitId === a.checkin.habitId && c.date === a.checkin.date);
        if (i >= 0) checkins.splice(i, 1);
        if (a.checkin.value > 0) checkins.push(a.checkin);
        return null;
      }
      case "list_docs": return docs[a.collection] ?? [];
      case "save_doc": upsert((docs[a.collection] ??= []), a.doc); return null;
      case "delete_doc": del(docs[a.collection] ?? [], a.id); return null;
      case "list_time_entries": return timeEntries;
      case "save_time_entry": upsert(timeEntries, a.entry); return null;
      case "delete_time_entry": del(timeEntries, a.id); return null;
      case "list_calendars": return [];
      case "list_external_events": return [];
      case "list_activities": return activities;
      case "save_activity": upsert(activities, a.activity); return null;
      case "delete_activity": del(activities, a.id); return null;
      case "get_activity_detail": return details[a.id] ?? null;
      case "list_daily_metrics": return daily;
      case "save_daily_metric": { const r = daily.find((d) => d.date === a.date); if (r) Object.assign(r, a.patch); else daily.push({ id: a.date, date: a.date, ...a.patch }); return null; }
      case "vault_info": return { path: "(browser mock - not saved)" };
      case "list_notes":
        return Object.entries(notes).map(([path, txt]) => ({ path, title: path.replace(/\.md$/, ""), modified: "", links: linksOf(txt) }));
      case "read_note": return notes[a.path] ?? "";
      case "write_note": notes[a.path] = a.content; return null;
      case "list_sheets": return [];
      case "export_file": return `(mock) Exports/${a.name}`;
      case "export_all": return "(mock) Exports/vaultx-backup.json";
      case "export_csv": return `(mock) Exports/${a.table}.csv`;
      case "api_status": return apiState;
      case "api_configure": apiState = { ...apiState, enabled: a.enabled, port: a.port, running: a.enabled }; return apiState;
      case "garmin_status": return { installed: false, hasTokens: false };
      default:
        throw `"${cmd}" is not available in the browser mock - run the desktop app`;
    }
  });
}

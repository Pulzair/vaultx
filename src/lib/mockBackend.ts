// In-memory stand-in for the Rust commands, used ONLY when the UI is opened in
// a plain browser during development (`npm run dev` -> http://localhost:1420).
// Lets you click through the UI without the desktop shell. Data resets on reload.
// Never bundled into the desktop app: main.tsx imports it behind a DEV + !Tauri check.
import { mockIPC } from "@tauri-apps/api/mocks";

type Row = Record<string, unknown> & { id: string };

export function installMockBackend() {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const day = (offset: number, h: number, m = 0) => {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(h)}:${pad(m)}`;
  };

  const settings: Record<string, string> = {};
  const lists: Row[] = [{ id: "inbox", name: "Inbox", color: "", sort: 0 }, { id: "school", name: "School", color: "", sort: 1 }];
  const tasks: Row[] = [
    { id: "t1", listId: "school", title: "Maths homework", note: "Chapter 4 exercises", tags: ["maths"], priority: 2,
      dueDate: day(0, 0).slice(0, 10), startAt: day(0, 13), endAt: day(0, 15), done: false, completedAt: null,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), sort: 1 },
    { id: "t2", listId: "inbox", title: "Plan long run route", note: "", tags: [], priority: 0,
      dueDate: day(1, 0).slice(0, 10), startAt: null, endAt: null, done: false, completedAt: null,
      createdAt: now.toISOString(), updatedAt: now.toISOString(), sort: 2 },
  ];
  const timeEntries: Row[] = [
    { id: "e1", taskId: "t1", title: "Maths homework", startAt: day(0, 13, 10) + ":00", endAt: day(0, 14, 5) + ":00", mode: "stopwatch", targetMin: null, note: "" },
  ];
  const activities: Row[] = [
    { id: "a1", source: "garmin", externalId: "1", sport: "running", name: "Morning Run", startTime: day(0, 7) + ":00",
      durationS: 2900, distanceM: 9100, avgHr: 148, maxHr: 171, elevationM: 64, calories: 610, avgPower: null },
    { id: "a2", source: "manual", externalId: "2", sport: "kayaking", name: "Lake paddle", startTime: day(-2, 17) + ":30",
      durationS: 4200, distanceM: 11000, avgHr: 128, maxHr: 150, elevationM: null, calories: 520, avgPower: null },
  ];
  const notes: Record<string, string> = { "Welcome.md": "# Welcome\n\nMock vault. See [[Ideas]].\n", "Ideas.md": "# Ideas\n\nBack to [[Welcome]].\n" };

  const upsert = (arr: Row[], row: Row) => {
    const i = arr.findIndex((r) => r.id === row.id);
    if (i < 0) arr.push(row); else arr[i] = row;
  };
  const del = (arr: Row[], id: string) => {
    const i = arr.findIndex((r) => r.id === id);
    if (i >= 0) arr.splice(i, 1);
  };
  const links = (t: string) => [...t.matchAll(/\[\[([^\]|#]+)/g)].map((m) => m[1].trim());

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
      case "list_time_entries": return timeEntries;
      case "save_time_entry": upsert(timeEntries, a.entry); return null;
      case "delete_time_entry": del(timeEntries, a.id); return null;
      case "list_calendars": return [];
      case "list_external_events": return [];
      case "list_activities": return activities;
      case "save_activity": upsert(activities, a.activity); return null;
      case "delete_activity": del(activities, a.id); return null;
      case "vault_info": return { path: "(browser mock - not saved)" };
      case "list_notes":
        return Object.entries(notes).map(([path, t]) => ({ path, title: path.replace(/\.md$/, ""), modified: "", links: links(t) }));
      case "read_note": return notes[a.path] ?? "";
      case "write_note": notes[a.path] = a.content; return null;
      case "list_sheets": return [];
      case "garmin_status": return { installed: false, hasTokens: false };
      default:
        throw `"${cmd}" is not available in the browser mock - run the desktop app`;
    }
  });
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errText } from "../../lib/api";
import { askConfirm, askText } from "../../lib/dialog";
import { renderMarkdown } from "../../lib/markdown";
import type { NoteMeta } from "../../lib/types";
import Editor from "./Editor";
import GraphView from "./GraphView";
import "./notes.css";

type Mode = "edit" | "preview" | "graph";

export default function NotesView() {
  const [notes, setNotes] = useState<NoteMeta[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [mode, setMode] = useState<Mode>("edit");
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pending = useRef<{ path: string; text: string } | null>(null);

  const refresh = useCallback(async () => {
    try {
      setNotes(await api.listNotes());
    } catch (e) {
      setError(errText(e));
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const flush = useCallback(async () => {
    window.clearTimeout(saveTimer.current);
    const p = pending.current;
    pending.current = null;
    if (p) {
      await api.writeNote(p.path, p.text).catch((e) => setError(errText(e)));
      refresh();
    }
  }, [refresh]);

  // Save on leaving the module.
  useEffect(() => () => void flush(), [flush]);

  const open = useCallback(
    async (path: string) => {
      await flush();
      try {
        setText(await api.readNote(path));
        setCurrent(path);
        setError(null);
        if (mode === "graph") setMode("edit");
      } catch (e) {
        setError(errText(e));
      }
    },
    [flush, mode],
  );

  // Open the first note on load.
  useEffect(() => {
    if (!current && notes.length) open(notes[0].path);
  }, [notes, current, open]);

  const onEdit = (v: string) => {
    setText(v);
    if (!current) return;
    pending.current = { path: current, text: v };
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flush, 600);
  };

  const byTitle = useMemo(() => {
    const m = new Map<string, NoteMeta>();
    notes.forEach((n) => m.set(n.title.toLowerCase(), n));
    return m;
  }, [notes]);

  /** Follow a [[wiki link]]; creates the note when it does not exist yet. */
  const openByTitle = useCallback(
    async (title: string) => {
      const hit = byTitle.get(title.toLowerCase());
      if (hit) return open(hit.path);
      const path = `${title.replace(/[\\/:*?"<>|]/g, "-")}.md`;
      await api.writeNote(path, `# ${title}\n\n`).catch((e) => setError(errText(e)));
      await refresh();
      open(path);
    },
    [byTitle, open, refresh],
  );

  const createNote = async () => {
    const name = await askText("Note name (use folder/name to file it in a folder)");
    if (!name?.trim()) return;
    const path = name.trim().replace(/\.md$/i, "") + ".md";
    if (notes.some((n) => n.path.toLowerCase() === path.toLowerCase())) return open(path);
    await api.writeNote(path, `# ${name.split("/").pop()}\n\n`).catch((e) => setError(errText(e)));
    await refresh();
    open(path);
  };

  const renameCurrent = async () => {
    if (!current) return;
    const to = await askText("Rename or move to", current);
    if (!to || to === current) return;
    await flush();
    try {
      await api.renameNote(current, to);
      await refresh();
      setCurrent(to);
    } catch (e) {
      setError(errText(e));
    }
  };

  const trashCurrent = async () => {
    if (!current || !(await askConfirm(`Move "${current}" to the vault's .trash folder?`, "Move to trash"))) return;
    pending.current = null;
    await api.trashFile(current).catch((e) => setError(errText(e)));
    setCurrent(null);
    setText("");
    refresh();
  };

  const currentMeta = notes.find((n) => n.path === current);
  const backlinks = currentMeta
    ? notes.filter((n) => n.links.some((l) => l.toLowerCase() === currentMeta.title.toLowerCase()))
    : [];

  const visible = filter
    ? notes.filter((n) => n.path.toLowerCase().includes(filter.toLowerCase()))
    : notes;

  const html = useMemo(() => (mode === "preview" ? renderMarkdown(text) : ""), [mode, text]);

  const onPreviewClick = (e: React.MouseEvent) => {
    const a = (e.target as HTMLElement).closest("a");
    if (!a) return;
    e.preventDefault();
    const wiki = a.getAttribute("data-wiki");
    if (wiki) openByTitle(decodeURIComponent(wiki));
    else if (a.href.startsWith("http")) import("@tauri-apps/plugin-opener").then((m) => m.openUrl(a.href));
  };

  return (
    <>
      <div className="bar">
        <h1>Notes</h1>
        <span className="sub">{current ?? "no note open"}</span>
        <div className="grow" />
        <div className="seg">
          {(["edit", "preview", "graph"] as Mode[]).map((m) => (
            <button key={m} aria-pressed={mode === m} onClick={() => setMode(m)}>
              {m[0].toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <button className="btn ghost" onClick={renameCurrent} disabled={!current}>Rename</button>
        <button className="btn ghost danger" onClick={trashCurrent} disabled={!current}>Trash</button>
        <button className="btn primary" onClick={createNote}>New note</button>
      </div>
      {error && <div className="error-line">{error}</div>}
      <div className="body">
        <div className="pane" style={{ width: 230 }}>
          <div style={{ padding: "10px 14px 6px" }}>
            <input className="input" style={{ width: "100%" }} placeholder="Filter notes" value={filter}
              onChange={(e) => setFilter(e.target.value)} />
          </div>
          <div className="scroll" style={{ flex: 1 }}>
            {visible.map((n) => {
              const parts = n.path.split("/");
              return (
                <div key={n.path} className={`list-item ${n.path === current ? "active" : ""}`}
                  style={{ paddingLeft: 14 + (parts.length - 1) * 12 }} onClick={() => open(n.path)} title={n.path}>
                  {parts.length > 1 && <span className="muted mono" style={{ fontSize: 11 }}>{parts.slice(0, -1).join("/")}/</span>}
                  {n.title}
                </div>
              );
            })}
            {!visible.length && <div className="empty">No notes</div>}
          </div>
        </div>

        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column" }}>
          {mode === "graph" ? (
            <GraphView notes={notes} current={currentMeta?.title ?? null} onOpen={openByTitle} />
          ) : !current ? (
            <div className="empty">Create a note to start.</div>
          ) : mode === "edit" ? (
            <Editor docKey={current} value={text} onChange={onEdit} />
          ) : (
            <div className="scroll preview" onClick={onPreviewClick} dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>

        {mode !== "graph" && currentMeta && (
          <div className="pane" style={{ width: 220, borderRight: 0, borderLeft: "1px solid var(--line)" }}>
            <div className="section-head"><span className="label">Linked from</span><span className="num muted">{backlinks.length}</span></div>
            {backlinks.map((b) => (
              <div key={b.path} className="list-item" onClick={() => open(b.path)}>{b.title}</div>
            ))}
            {!backlinks.length && <div className="list-item muted">Nothing links here</div>}
            <div className="section-head"><span className="label">Links to</span><span className="num muted">{currentMeta.links.length}</span></div>
            {[...new Set(currentMeta.links)].map((l) => (
              <div key={l} className="list-item" onClick={() => openByTitle(l)}>
                {l}
                {!byTitle.has(l.toLowerCase()) && <span className="count">new</span>}
              </div>
            ))}
            <div className="section-head"><span className="label">Modified</span></div>
            <div className="list-item num">{currentMeta.modified.replace("T", " ")}</div>
          </div>
        )}
      </div>
    </>
  );
}

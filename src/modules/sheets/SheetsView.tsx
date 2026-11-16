import { useCallback, useEffect, useRef, useState } from "react";
import Spreadsheet from "x-data-spreadsheet";
import "x-data-spreadsheet/dist/xspreadsheet.css";
import { api, errText } from "../../lib/api";
import { askConfirm, askText } from "../../lib/dialog";
import type { NoteMeta } from "../../lib/types";
import "./sheets.css";

// x-data-spreadsheet stores sheets as [{ name, rows: { [r]: { cells: { [c]: { text } } } }, ... }]
type SheetData = { name: string; rows: Record<string, { cells?: Record<string, { text?: string }> } | number> }[];

function toCsv(sheet: SheetData[number]): string {
  const rows = sheet.rows ?? {};
  const out: string[] = [];
  const rowIdx = Object.keys(rows).filter((k) => k !== "len").map(Number).sort((a, b) => a - b);
  const last = rowIdx.length ? rowIdx[rowIdx.length - 1] : -1;
  for (let r = 0; r <= last; r++) {
    const row = rows[r] as { cells?: Record<string, { text?: string }> } | undefined;
    const cells = row?.cells ?? {};
    const ci = Object.keys(cells).map(Number);
    const maxC = ci.length ? Math.max(...ci) : -1;
    const line: string[] = [];
    for (let c = 0; c <= maxC; c++) {
      const t = cells[c]?.text ?? "";
      line.push(/[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t);
    }
    out.push(line.join(","));
  }
  return out.join("\n");
}

function fromCsv(name: string, text: string): SheetData[number] {
  const rows: SheetData[number]["rows"] = {};
  let r = 0, c = 0, cur = "", q = false;
  const put = () => {
    const row = (rows[r] ??= { cells: {} }) as { cells: Record<string, { text: string }> };
    if (cur !== "") row.cells[c] = { text: cur };
    cur = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { put(); c++; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      put(); r++; c = 0;
    } else cur += ch;
  }
  if (cur || c) put();
  return { name, rows: { ...rows, len: Math.max(100, r + 10) } };
}

export default function SheetsView() {
  const [sheets, setSheets] = useState<NoteMeta[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(true);
  const host = useRef<HTMLDivElement>(null);
  const grid = useRef<Spreadsheet | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const csvInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const s = await api.listSheets();
      setSheets(s);
      return s;
    } catch (e) {
      setError(errText(e));
      return [];
    }
  }, []);

  useEffect(() => {
    refresh().then((s) => s.length && setCurrent((c) => c ?? s[0].path));
  }, [refresh]);

  const save = useCallback(async () => {
    window.clearTimeout(timer.current);
    if (!grid.current || !current) return;
    await api.writeNote(current, JSON.stringify(grid.current.getData()))
      .then(() => setSaved(true))
      .catch((e) => setError(errText(e)));
  }, [current]);

  // (Re)build the grid whenever the open sheet changes.
  useEffect(() => {
    if (!current || !host.current) return;
    let cancelled = false;
    host.current.innerHTML = "";
    api.readNote(current).then((text) => {
      if (cancelled || !host.current) return;
      let data: SheetData = [];
      try { data = text.trim() ? JSON.parse(text) : []; } catch { setError("Sheet file is not valid JSON"); }
      const el = document.createElement("div");
      host.current.appendChild(el);
      const r = host.current.getBoundingClientRect();
      grid.current = new Spreadsheet(el, {
        showToolbar: true,
        showGrid: true,
        showBottomBar: true,
        view: { height: () => r.height, width: () => host.current?.clientWidth ?? r.width },
        row: { len: 200, height: 24 },
        col: { len: 30, width: 100, indexWidth: 50, minWidth: 40 },
        style: { font: { name: "IBM Plex Sans", size: 10, bold: false, italic: false } },
      } as never).loadData(data.length ? data : [{ name: "Sheet1", rows: {} }]);
      grid.current.change(() => {
        setSaved(false);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(save, 800);
      });
    }).catch((e) => setError(errText(e)));
    return () => { cancelled = true; };
  }, [current, save]);

  // Flush unsaved edits on unmount.
  useEffect(() => () => void save(), [save]);

  const create = async () => {
    const name = await askText("Spreadsheet name", "Budget");
    if (!name?.trim()) return;
    const path = `Sheets/${name.trim().replace(/[\\/:*?"<>|]/g, "-")}.vxsheet`;
    await save();
    await api.writeNote(path, JSON.stringify([{ name: "Sheet1", rows: {} }])).catch((e) => setError(errText(e)));
    await refresh();
    setCurrent(path);
  };

  const rename = async () => {
    if (!current) return;
    const old = current.replace(/^Sheets\//, "").replace(/\.vxsheet$/, "");
    const name = await askText("Rename spreadsheet", old);
    if (!name?.trim() || name === old) return;
    await save();
    const to = `Sheets/${name.trim()}.vxsheet`;
    try { await api.renameNote(current, to); await refresh(); setCurrent(to); } catch (e) { setError(errText(e)); }
  };

  const trash = async () => {
    if (!current || !(await askConfirm("Move this spreadsheet to the vault's .trash folder?", "Move to trash"))) return;
    await api.trashFile(current).catch((e) => setError(errText(e)));
    setCurrent(null);
    if (host.current) host.current.innerHTML = "";
    const s = await refresh();
    if (s.length) setCurrent(s[0].path);
  };

  const exportCsv = async () => {
    if (!grid.current || !current) return;
    const data = grid.current.getData() as SheetData;
    const base = current.replace(/^Sheets\//, "").replace(/\.vxsheet$/, "");
    try {
      const paths = [];
      for (const s of data) paths.push(await api.exportFile(`${base} - ${s.name}.csv`, toCsv(s)));
      setError(null);
      setInfo(`Exported ${paths.length} CSV file(s) to the vault Exports folder.`);
    } catch (e) { setError(errText(e)); }
  };
  const [info, setInfo] = useState<string | null>(null);

  const importCsv = async (f: File) => {
    const text = await f.text();
    const name = f.name.replace(/\.csv$/i, "");
    const path = `Sheets/${name}.vxsheet`;
    await api.writeNote(path, JSON.stringify([fromCsv("Sheet1", text)])).catch((e) => setError(errText(e)));
    await refresh();
    setCurrent(path);
  };

  return (
    <>
      <div className="bar">
        <h1>Sheets</h1>
        <span className="sub">{current ? `${current}${saved ? "" : "  - saving"}` : ""}</span>
        <div className="grow" />
        <button className="btn ghost" onClick={() => csvInput.current?.click()}>Import CSV</button>
        <button className="btn ghost" onClick={exportCsv} disabled={!current}>Export CSV</button>
        <button className="btn ghost" onClick={rename} disabled={!current}>Rename</button>
        <button className="btn ghost danger" onClick={trash} disabled={!current}>Trash</button>
        <button className="btn primary" onClick={create}>New sheet</button>
        <input ref={csvInput} type="file" accept=".csv,text/csv" hidden
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importCsv(f); e.target.value = ""; }} />
      </div>
      {error && <div className="error-line">{error}</div>}
      {info && <div className="error-line" style={{ color: "var(--ink-2)" }} onClick={() => setInfo(null)}>{info}</div>}
      <div className="body">
        <div className="pane" style={{ width: 200 }}>
          <div style={{ height: 8 }} />
          {sheets.map((s) => (
            <div key={s.path} className={`list-item ${s.path === current ? "active" : ""}`}
              onClick={async () => { await save(); setCurrent(s.path); }}>{s.title}</div>
          ))}
          {!sheets.length && <div className="empty">No spreadsheets yet. Formulas such as =SUM(A1:A9) work in cells.</div>}
        </div>
        <div ref={host} className="sheet-host" />
      </div>
    </>
  );
}

// Digest: a small RSS/Atom reader that ranks headlines by the user's
// interest keywords. Experimental and optional, as the brief allows.
// Feeds and interests are stored in settings; nothing is sent anywhere
// except the feed requests themselves.
import { useEffect, useMemo, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { api, errText } from "../../lib/api";

interface Item { title: string; link: string; date: string; source: string; summary: string }

const DEFAULT_FEEDS = [
  "https://feeds.bbci.co.uk/news/world/rss.xml",
  "https://www.theguardian.com/science/rss",
];

function parseFeed(xml: string, source: string): Item[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const text = (el: Element | null, sel: string) => el?.querySelector(sel)?.textContent?.trim() ?? "";
  const items = Array.from(doc.querySelectorAll("item, entry"));
  const title = doc.querySelector("channel > title, feed > title")?.textContent?.trim() || source;
  return items.map((it) => ({
    title: text(it, "title"),
    link: text(it, "link") || it.querySelector("link")?.getAttribute("href") || "",
    date: text(it, "pubDate") || text(it, "updated") || text(it, "published"),
    source: title,
    summary: text(it, "description").replace(/<[^>]+>/g, "").slice(0, 240) || text(it, "summary").slice(0, 240),
  }));
}

export default function DigestView() {
  const [feeds, setFeeds] = useState<string[]>([]);
  const [interests, setInterests] = useState("");
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [newFeed, setNewFeed] = useState("");

  useEffect(() => {
    api.getSettings().then((s) => {
      setFeeds(s.digest_feeds ? JSON.parse(s.digest_feeds) : DEFAULT_FEEDS);
      setInterests(s.digest_interests ?? "");
    });
  }, []);

  const saveFeeds = (f: string[]) => {
    setFeeds(f);
    api.setSetting("digest_feeds", JSON.stringify(f));
  };

  const refresh = async () => {
    setBusy(true);
    const errs: string[] = [];
    const all: Item[] = [];
    await Promise.all(feeds.map(async (url) => {
      try { all.push(...parseFeed(await api.fetchText(url), url)); } catch (e) { errs.push(`${url}: ${errText(e)}`); }
    }));
    setItems(all);
    setErrors(errs);
    setBusy(false);
  };

  const keywords = interests.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean);
  const ranked = useMemo(() => {
    const score = (it: Item) => keywords.reduce((s, k) => s + ((it.title + " " + it.summary).toLowerCase().includes(k) ? 1 : 0), 0);
    return items
      .map((it) => ({ it, s: score(it), t: Date.parse(it.date) || 0 }))
      .sort((a, b) => b.s - a.s || b.t - a.t);
  }, [items, keywords.join(",")]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <div className="bar">
        <h1>Digest</h1>
        <span className="sub">experimental</span>
        <div className="grow" />
        <button className="btn primary" disabled={busy || !feeds.length} onClick={refresh}>{busy ? "Fetching" : "Refresh"}</button>
      </div>
      {errors.map((e) => <div key={e} className="error-line">{e}</div>)}
      <div className="body">
        <div className="scroll" style={{ flex: 1, background: "var(--surface)" }}>
          {ranked.map(({ it, s }) => (
            <div key={it.link + it.title} style={{ padding: "10px 18px", borderBottom: "1px solid var(--line)", maxWidth: 820 }}>
              <div className="row" style={{ gap: 10 }}>
                <span className="label">{it.source}</span>
                {s > 0 && <span className="mono" style={{ fontSize: 11, color: "var(--accent)" }}>matches {s}</span>}
                <span className="muted num" style={{ fontSize: 11, marginLeft: "auto" }}>{it.date ? new Date(it.date).toLocaleString() : ""}</span>
              </div>
              <a href="#" style={{ color: "var(--ink)", fontWeight: 500, fontSize: 14, textDecoration: "none" }}
                onClick={(e) => { e.preventDefault(); if (it.link.startsWith("http")) openUrl(it.link); }}>{it.title}</a>
              {it.summary && <div style={{ color: "var(--ink-2)", marginTop: 2 }}>{it.summary}</div>}
            </div>
          ))}
          {!ranked.length && <div className="empty">Press Refresh to pull headlines from your feeds.</div>}
        </div>
        <div className="pane" style={{ width: 290, borderRight: 0, borderLeft: "1px solid var(--line)" }}>
          <div className="side-block" style={{ padding: "12px 14px", display: "grid", gap: 8, borderBottom: "1px solid var(--line)" }}>
            <div className="label">Interests</div>
            <input className="input" placeholder="running, rust, climate" value={interests}
              onChange={(e) => setInterests(e.target.value)} onBlur={() => api.setSetting("digest_interests", interests)} />
            <div className="muted" style={{ fontSize: 12 }}>Comma-separated. Matching headlines rise to the top.</div>
          </div>
          <div className="section-head"><span className="label">Feeds</span></div>
          {feeds.map((f) => (
            <div key={f} className="list-item" style={{ justifyContent: "space-between" }} title={f}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{f.replace(/^https?:\/\//, "")}</span>
              <button className="btn ghost danger" style={{ padding: "0 6px" }} onClick={() => saveFeeds(feeds.filter((x) => x !== f))}>x</button>
            </div>
          ))}
          <div className="row" style={{ padding: "8px 14px" }}>
            <input className="input" style={{ flex: 1 }} placeholder="RSS or Atom URL" value={newFeed} onChange={(e) => setNewFeed(e.target.value)} />
            <button className="btn" disabled={!newFeed.trim()} onClick={() => { saveFeeds([...feeds, newFeed.trim()]); setNewFeed(""); }}>Add</button>
          </div>
        </div>
      </div>
    </>
  );
}

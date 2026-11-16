import { marked } from "marked";

/** Turns [[Target|alias]] into links the preview can intercept. */
function wikiToHtml(md: string): string {
  return md.replace(/\[\[([^\]\n|#]+)(#[^\]\n|]*)?(\|([^\]\n]+))?\]\]/g, (_m, target, _h, _a, alias) => {
    const t = String(target).trim();
    const label = (alias ?? t).trim();
    return `<a href="#" data-wiki="${encodeURIComponent(t)}" class="wiki">${label}</a>`;
  });
}

/**
 * Notes can be pasted from anywhere, and this webview can call app commands,
 * so strip anything executable before injecting rendered HTML.
 */
function sanitize(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("script,iframe,object,embed,style,link,meta,form").forEach((n) => n.remove());
  doc.querySelectorAll("*").forEach((el) => {
    for (const attr of Array.from(el.attributes)) {
      const name = attr.name.toLowerCase();
      const val = attr.value.trim().toLowerCase();
      if (name.startsWith("on") || ((name === "href" || name === "src") && val.startsWith("javascript:"))) {
        el.removeAttribute(attr.name);
      }
    }
  });
  return doc.body.innerHTML;
}

export function renderMarkdown(md: string): string {
  return sanitize(marked.parse(wikiToHtml(md), { async: false, gfm: true }) as string);
}

import { useEffect, useRef } from "react";
import {
  forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide,
  type SimulationNodeDatum, type SimulationLinkDatum,
} from "d3-force";
import type { NoteMeta } from "../../lib/types";

interface Node extends SimulationNodeDatum {
  id: string; // lower-cased title
  label: string;
  path: string | null; // null = link to a note that does not exist yet
  degree: number;
}
type Link = SimulationLinkDatum<Node>;

interface Props {
  notes: NoteMeta[];
  current: string | null;
  onOpen: (title: string) => void;
}

const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Force-directed map of [[wiki links]] between notes, drawn on a canvas. */
export default function GraphView({ notes, current, onOpen }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const dpr = window.devicePixelRatio || 1;

    const nodes = new Map<string, Node>();
    for (const n of notes) {
      nodes.set(n.title.toLowerCase(), { id: n.title.toLowerCase(), label: n.title, path: n.path, degree: 0 });
    }
    const links: Link[] = [];
    for (const n of notes) {
      for (const target of n.links) {
        const key = target.toLowerCase();
        if (!nodes.has(key)) nodes.set(key, { id: key, label: target, path: null, degree: 0 });
        links.push({ source: n.title.toLowerCase(), target: key });
        nodes.get(key)!.degree++;
        nodes.get(n.title.toLowerCase())!.degree++;
      }
    }
    const nodeList = [...nodes.values()];
    const currentKey = current?.toLowerCase();

    let w = 0, h = 0;
    let transform = { x: 0, y: 0, k: 1 };
    let hover: Node | null = null;

    const resize = () => {
      const r = canvas.getBoundingClientRect();
      w = r.width; h = r.height;
      canvas.width = w * dpr; canvas.height = h * dpr;
    };
    resize();

    const sim = forceSimulation(nodeList)
      .force("link", forceLink<Node, Link>(links).id((d) => d.id).distance(60))
      .force("charge", forceManyBody().strength(-160))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide(14));

    const radius = (n: Node) => 3 + Math.min(6, Math.sqrt(n.degree) * 1.6);

    const draw = () => {
      const ink = css("--ink"), ink3 = css("--ink-3"), line = css("--line-strong"), accent = css("--accent");
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.translate(w / 2 + transform.x, h / 2 + transform.y);
      ctx.scale(transform.k, transform.k);

      ctx.strokeStyle = line;
      ctx.lineWidth = 1 / transform.k;
      ctx.beginPath();
      for (const l of links) {
        const s = l.source as Node, t = l.target as Node;
        ctx.moveTo(s.x!, s.y!);
        ctx.lineTo(t.x!, t.y!);
      }
      ctx.stroke();

      ctx.font = `${11 / transform.k}px "IBM Plex Mono", monospace`;
      for (const n of nodeList) {
        const isCur = n.id === currentKey;
        ctx.beginPath();
        ctx.arc(n.x!, n.y!, radius(n), 0, Math.PI * 2);
        if (n.path) {
          ctx.fillStyle = isCur ? accent : ink;
          ctx.fill();
        } else {
          ctx.strokeStyle = ink3;
          ctx.stroke();
        }
        if (isCur || n === hover || transform.k > 1.2 || n.degree > 2) {
          ctx.fillStyle = isCur ? accent : n.path ? ink : ink3;
          ctx.fillText(n.label, n.x! + radius(n) + 4, n.y! + 4);
        }
      }
    };
    sim.on("tick", draw);

    const toWorld = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left - w / 2 - transform.x) / transform.k,
        y: (e.clientY - r.top - h / 2 - transform.y) / transform.k,
      };
    };
    const pick = (e: MouseEvent) => {
      const p = toWorld(e);
      return nodeList.find((n) => Math.hypot(n.x! - p.x, n.y! - p.y) < radius(n) + 4) ?? null;
    };

    let drag: { node: Node | null; sx: number; sy: number; ox: number; oy: number; moved: boolean } | null = null;
    const onDown = (e: MouseEvent) => {
      const node = pick(e);
      drag = { node, sx: e.clientX, sy: e.clientY, ox: transform.x, oy: transform.y, moved: false };
      if (node) sim.alphaTarget(0.3).restart();
    };
    const onMove = (e: MouseEvent) => {
      if (!drag) {
        const n = pick(e);
        if (n !== hover) { hover = n; canvas.style.cursor = n ? "pointer" : "default"; draw(); }
        return;
      }
      const dx = e.clientX - drag.sx, dy = e.clientY - drag.sy;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.node) {
        const p = toWorld(e);
        drag.node.fx = p.x; drag.node.fy = p.y;
      } else {
        transform.x = drag.ox + dx; transform.y = drag.oy + dy;
        draw();
      }
    };
    const onUp = () => {
      if (drag?.node) {
        if (!drag.moved) onOpen(drag.node.label);
        drag.node.fx = null; drag.node.fy = null;
        sim.alphaTarget(0);
      }
      drag = null;
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      transform.k = Math.min(4, Math.max(0.25, transform.k * (e.deltaY < 0 ? 1.1 : 0.9)));
      draw();
    };

    canvas.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: false });
    const ro = new ResizeObserver(() => { resize(); draw(); });
    ro.observe(canvas);

    return () => {
      sim.stop();
      ro.disconnect();
      canvas.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, [notes, current, onOpen]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block", background: "var(--surface)" }} />;
}

// User-assignable colours for lists, tags and habits. Chosen to be distinct
// from each other and readable on both themes; "" means no colour.
export const SWATCHES = [
  "#2a78d6", // blue
  "#eb6834", // orange
  "#1baf7a", // aqua
  "#eda100", // yellow
  "#e87ba4", // pink
  "#2f8f2f", // green
  "#6250d6", // violet
  "#e34948", // red
  "#7a7f87", // grey
  "#8a5a2b", // brown
];

/** Translucent fill for a colour, for tinted backgrounds. */
export function tint(hex: string, alpha = 0.16): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "transparent";
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/** Black or white text, whichever reads better on `hex`. */
export function inkOn(hex: string): string {
  if (!/^#[0-9a-f]{6}$/i.test(hex)) return "var(--ink)";
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.4 ? "#15171a" : "#ffffff";
}

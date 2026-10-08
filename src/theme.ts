// Styled lines and the themes that colour them, after jboard's: everything on screen is a list of
// (text, style) segments, and a theme maps style names (card, accent, key, ...) to terminal escape codes.

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const ITALIC = "\x1b[3m";
const REVERSE = "\x1b[7m";
const STRIKE = "\x1b[9m";

/** A style name like "card" or "dim", optionally combined: "card+dim+strike". */
export type Style = string | null;
export type Segment = [text: string, style: Style];
export type Line = Segment[];

export const chars = (s: string) => Array.from(s);
export const lineLen = (line: Line) => line.reduce((n, [text]) => n + chars(text).length, 0);

/** Cuts text to n characters, ending in … when it doesn't fit. */
export const shorten = (text: string, n: number) => {
  const cs = chars(text);
  return cs.length <= n ? text : `${cs.slice(0, Math.max(0, n - 1)).join("")}…`;
};

/** 24-bit colour where the terminal supports it, otherwise the nearest of the 256 xterm colours. */
const TRUECOLOR = /truecolor|24bit/i.test(process.env.COLORTERM ?? "")
  || ["iTerm.app", "WezTerm", "ghostty", "vscode"].includes(process.env.TERM_PROGRAM ?? "")
  || process.env.RIG_TRUECOLOR === "1";

function to256(r: number, g: number, b: number): number {
  const steps = [0, 95, 135, 175, 215, 255];
  const level = (v: number) => (v < 48 ? 0 : v < 115 ? 1 : Math.floor((v - 35) / 40));
  const [cr, cg, cb] = [level(r), level(g), level(b)];
  const cubeDist = (steps[cr] - r) ** 2 + (steps[cg] - g) ** 2 + (steps[cb] - b) ** 2;
  const gray = Math.max(0, Math.min(23, Math.round(((r + g + b) / 3 - 8) / 10)));
  const gv = 8 + gray * 10;
  const grayDist = (gv - r) ** 2 + (gv - g) ** 2 + (gv - b) ** 2;
  return grayDist < cubeDist ? 232 + gray : 16 + 36 * cr + 6 * cg + cb;
}

function rgb(hex: string, layer: 38 | 48): string {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return TRUECOLOR ? `\x1b[${layer};2;${r};${g};${b}m` : `\x1b[${layer};5;${to256(r, g, b)}m`;
}
const fg = (hex: string) => rgb(hex, 38);
const bg = (hex: string) => rgb(hex, 48);

interface Palette {
  text: string; muted: string; faint: string; // foregrounds
  card: string; cardSel: string; panel: string; optSel: string; // backgrounds
  accent: string; done: string; warn: string; track: string;
  onAccent: string; // text on an accent-filled pill
}

export interface Theme {
  corners: string; // dialog corners: top-left, top-right, bottom-left, bottom-right
  icons: { logo: string; dot: string; info: string; open: string; done: string; moved: string; add: string; edit: string;
    bar: string; barSel: string; full: string; empty: string };
  codes: Record<string, string>; // style name -> escape codes
}

/** Dark: muted slate cards, the same colours as jboard's night theme. */
const NIGHT: Palette = {
  text: "#cdd6e0", muted: "#8b98a5", faint: "#5d6873",
  card: "#1d232b", cardSel: "#2e3743", panel: "#232a33", optSel: "#3a4656",
  accent: "#5aa2f0", done: "#5fb86a", warn: "#ec6a5e", track: "#38424e",
  onAccent: "#12161c",
};

/** Light: soft grey cards for white terminals. */
const DAY: Palette = {
  text: "#1f2328", muted: "#59636e", faint: "#8c959f",
  card: "#f2f4f7", cardSel: "#dbe5f2", panel: "#f6f8fa", optSel: "#cfe0f7",
  accent: "#0969da", done: "#1a7f37", warn: "#cf222e", track: "#d0d7de",
  onAccent: "#ffffff",
};

function paletteTheme(p: Palette): Theme {
  const codes: Record<string, string> = {
    text: fg(p.text), dim: fg(p.faint), name: fg(p.muted), title: BOLD + fg(p.text), bold: BOLD,
    accent: BOLD + fg(p.accent), info: fg(p.accent), done: fg(p.done), warn: BOLD + fg(p.warn),
    progress: fg(p.done), track: fg(p.track), rule: fg(p.track), strike: STRIKE, empty: ITALIC + fg(p.faint),
    card: bg(p.card) + fg(p.text), cardsel: bg(p.cardSel) + fg(p.text),
    pill: BOLD + bg(p.accent) + fg(p.onAccent), pilldone: BOLD + bg(p.done) + fg(p.onAccent),
    rev: BOLD + bg(p.optSel) + fg(p.text), panel: bg(p.panel) + fg(p.text),
    box: bg(p.panel) + fg(p.muted), boxtitle: BOLD + bg(p.panel) + fg(p.text),
    key: BOLD + bg(p.cardSel) + fg(p.text), keylabel: fg(p.muted), msg: BOLD + fg(p.text),
  };
  return {
    corners: "╭╮╰╯", codes,
    icons: { logo: "◆", dot: "●", info: "●", open: "○", done: "✓", moved: "→", add: "+", edit: "✎", bar: "▎", barSel: "▌", full: "━", empty: "━" },
  };
}

/** The 16 basic terminal colours, reverse video for selection. */
function classicTheme(): Theme {
  const codes: Record<string, string> = {
    text: "", dim: DIM, name: DIM, title: BOLD, bold: BOLD,
    accent: `${BOLD}\x1b[36m`, info: "\x1b[36m", done: "\x1b[32m", warn: `${BOLD}\x1b[31m`,
    progress: "\x1b[32m", track: DIM, rule: DIM, strike: STRIKE, empty: DIM,
    card: "", cardsel: REVERSE, pill: `${BOLD}\x1b[36m${REVERSE}`, pilldone: `${BOLD}\x1b[32m${REVERSE}`,
    rev: REVERSE, panel: "", box: BOLD, boxtitle: BOLD, key: REVERSE, keylabel: DIM, msg: "",
  };
  return {
    corners: "┌┐└┘", codes,
    icons: { logo: "*", dot: "", info: "", open: "[ ]", done: "[x]", moved: "[>]", add: ">", edit: ">", bar: " ", barSel: ">", full: "█", empty: "░" },
  };
}

const THEMES: Record<string, () => Theme> = { night: () => paletteTheme(NIGHT), day: () => paletteTheme(DAY), classic: classicTheme };
export const THEME_NAMES = Object.keys(THEMES);

/** The theme in use; importers see the switch made by useTheme(). */
export let theme: Theme = THEMES.night();

export function useTheme(name: string): boolean {
  const make = THEMES[name];
  if (make) theme = make();
  return !!make;
}

const styleCode = (style: Style) => (style ? style.split("+").map((s) => theme.codes[s] ?? "").join("") : "");

/** Render a line, padded with spaces to `width`. */
export function ansi(line: Line, width = 0): string {
  const out = line.map(([text, style]) => (style && text ? `${styleCode(style)}${text}${RESET}` : text)).join("");
  return out + " ".repeat(Math.max(0, width - lineLen(line)));
}

/** Pads a line with `style` (e.g. a card's background) up to `width`. */
export function fill(line: Line, width: number, style: Style): Line {
  const len = lineLen(line);
  return len < width ? [...line, [" ".repeat(width - len), style]] : line;
}

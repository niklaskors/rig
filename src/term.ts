// The full screen and drawing helpers, after punch's.

import { emitKeypressEvents } from "node:readline";
import { ansi, chars, lineLen, shorten, theme, type Line } from "./theme.ts";

/** Left margin of everything on screen. */
export const MARGIN = 2;
export const MAX_WIDTH = 100;
const ESCAPE_MS = 50;

export interface Key {
  name?: string;
  ctrl?: boolean;
  meta?: boolean;
  sequence?: string;
}

export type KeyHandler = (str: string | undefined, key: Key) => void;

/** The width content gets: the terminal's, less the margins, up to MAX_WIDTH. */
export const contentWidth = () => Math.max(20, Math.min(MAX_WIDTH, (process.stdout.columns || 80) - MARGIN * 2));
export const screenHeight = () => process.stdout.rows || 24;

let opened = false;

/** Switches to the full screen; keys go to onKey, and the screen is drawn again after each key and resize. */
export function openScreen(onKey: KeyHandler, draw: () => void) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || !stdout.isTTY) {
    console.error("rig: picking a script needs an interactive terminal; name it instead: rig WORKSPACE [SCRIPT]");
    process.exit(2);
  }
  opened = true;
  // readline tells a lone escape apart from a key sequence after 500ms by default; 50ms makes it react at once.
  emitKeypressEvents(stdin, { escapeCodeTimeout: ESCAPE_MS } as never);
  stdin.setRawMode(true);
  stdout.write("\x1b[?1049h");
  process.on("exit", closeScreen);
  stdin.on("keypress", (str: string | undefined, key: Key | undefined) => {
    const k = key ?? { sequence: str };
    if (k.ctrl && k.name === "c") process.exit(130);
    onKey(str, k);
    if (opened) draw();
  });
  stdout.on("resize", () => opened && draw());
  draw();
}

/** Leaves the full screen and gives the terminal back, e.g. to a script. */
export function closeScreen() {
  if (!opened) return;
  opened = false;
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.stdout.write("\x1b[?25h\x1b[?1049l");
}

/** Draws the lines from the top, each indented by the margin, clearing what was there; the cursor is hidden. */
export function paint(lines: Line[]) {
  const left = " ".repeat(MARGIN);
  const out = lines.slice(0, screenHeight()).map((line) => (line.length ? left + ansi(line) : ""));
  process.stdout.write(`\x1b[?25l\x1b[H${out.join("\x1b[K\r\n")}\x1b[K\x1b[J`);
}

/** The keys as keycaps, as many whole ones as fit, most important first; or a message instead. */
export function footer(hints: [string, string][], width: number, msg = ""): Line {
  if (msg) {
    const icon = theme.icons.info ? `${theme.icons.info} ` : "";
    return [[icon, "warn"], [shorten(msg, width - chars(icon).length), "msg"]];
  }
  const line: Line = [];
  for (const [key, label] of hints) {
    const hint: Line = [[` ${key} `, "key"], [` ${label}  `, "keylabel"]];
    if (lineLen(line) + lineLen(hint) > width) break;
    line.push(...hint);
  }
  return line;
}

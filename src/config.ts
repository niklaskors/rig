// The config: workspaces, each with named scripts. A script runs a shell command, or opens a layout of iTerm2
// tabs and panes. It is one JSON file, checked when read so mistakes are reported with where they are.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

/** A pane runs a command; or it is split into columns (side by side) or rows (stacked) of panes. */
export interface Pane {
  run?: string;
  /** Where the pane starts; relative to the pane it's in. */
  cwd?: string;
  /** Its share of the split, relative to the others' (default 1). */
  size?: number;
  /** The pane that has the focus when the layout is open. */
  focus?: boolean;
  /** An iTerm2 profile, for this pane and the panes in it. */
  profile?: string;
  columns?: Pane[];
  rows?: Pane[];
}

export interface Tab extends Pane {
  title?: string;
}

export interface Layout {
  /** A new window (default), or new tabs in the current one. */
  window?: "new" | "current";
  /** Make a new window fill the screen. */
  zoom?: boolean;
  profile?: string;
  tabs: Tab[];
}

export interface Script {
  description?: string;
  cwd?: string;
  /** A shell command, run in this terminal. */
  run?: string;
  /** Or a layout to open in iTerm2. */
  iterm?: Layout;
}

export interface Workspace {
  description?: string;
  /** Where its scripts start, unless they say otherwise. */
  cwd?: string;
  /** The script `rig WORKSPACE` runs; else the first one. */
  default?: string;
  scripts: Record<string, Script>;
}

export interface Config {
  workspaces: Record<string, Workspace>;
}

export class ConfigError extends Error {}

const home = homedir();

export const configFile = () =>
  process.env.RIG_CONFIG ? expand(process.env.RIG_CONFIG)
    : join(process.env.XDG_CONFIG_HOME || join(home, ".config"), "rig", "config.json");

/** ~ for the home directory, so paths fit on screen. */
export const tildify = (path: string) => (path === home || path.startsWith(home + "/") ? "~" + path.slice(home.length) : path);

/** An absolute path: ~ expands, and a relative path is taken from `base`. */
export const expand = (path: string, base = process.cwd()) => resolve(base, path.replace(/^~(?=$|\/)/, home));

/** The config, or null when there is none yet. */
export function readConfig(file = configFile()): Config | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (err) {
    throw new ConfigError(`${tildify(file)} isn't valid JSON: ${(err as Error).message}`);
  }
  const problem = check(data);
  if (problem) throw new ConfigError(`${tildify(file)}: ${problem}`);
  return data as Config;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const KNOWN = {
  config: ["$schema", "workspaces"],
  workspace: ["description", "cwd", "default", "scripts"],
  script: ["description", "cwd", "run", "iterm"],
  layout: ["window", "zoom", "profile", "tabs"],
  pane: ["run", "cwd", "size", "focus", "profile", "columns", "rows"],
  tab: ["title", "run", "cwd", "size", "focus", "profile", "columns", "rows"],
};

function unknownKey(obj: Record<string, unknown>, known: string[], at: string): string | null {
  const key = Object.keys(obj).find((k) => !known.includes(k));
  return key === undefined ? null : `${at} has "${key}", which rig doesn't know (it knows ${known.filter((k) => k !== "$schema").join(", ")})`;
}

function strings(obj: Record<string, unknown>, keys: string[], at: string): string | null {
  const key = keys.find((k) => obj[k] !== undefined && typeof obj[k] !== "string");
  return key === undefined ? null : `${at}.${key} should be text`;
}

/** What's wrong with the config, or null. */
export function check(data: unknown): string | null {
  if (!isObject(data)) return "the config should be an object with \"workspaces\"";
  const problem = unknownKey(data, KNOWN.config, "the config");
  if (problem) return problem;
  if (!isObject(data.workspaces)) return "\"workspaces\" should be an object of workspaces by name";
  for (const [name, ws] of Object.entries(data.workspaces)) {
    const at = `workspaces.${name}`;
    if (!isObject(ws)) return `${at} should be an object`;
    const p = unknownKey(ws, KNOWN.workspace, at) ?? strings(ws, ["description", "cwd", "default"], at);
    if (p) return p;
    if (!isObject(ws.scripts) || !Object.keys(ws.scripts).length) return `${at}.scripts should be an object with at least one script`;
    if (typeof ws.default === "string" && !(ws.default in ws.scripts)) return `${at}.default is "${ws.default}", which isn't one of its scripts`;
    for (const [sname, script] of Object.entries(ws.scripts)) {
      const p = checkScript(script, `${at}.scripts.${sname}`);
      if (p) return p;
    }
  }
  return null;
}

function checkScript(script: unknown, at: string): string | null {
  if (!isObject(script)) return `${at} should be an object`;
  const p = unknownKey(script, KNOWN.script, at) ?? strings(script, ["description", "cwd", "run"], at);
  if (p) return p;
  if ((script.run === undefined) === (script.iterm === undefined)) return `${at} needs either "run" (a command) or "iterm" (a layout)`;
  if (script.iterm === undefined) return null;
  const layout = script.iterm;
  if (!isObject(layout)) return `${at}.iterm should be an object with "tabs"`;
  const lp = unknownKey(layout, KNOWN.layout, `${at}.iterm`) ?? strings(layout, ["profile"], `${at}.iterm`);
  if (lp) return lp;
  if (layout.window !== undefined && layout.window !== "new" && layout.window !== "current") {
    return `${at}.iterm.window should be "new" or "current"`;
  }
  if (layout.zoom !== undefined && typeof layout.zoom !== "boolean") return `${at}.iterm.zoom should be true or false`;
  if (!Array.isArray(layout.tabs) || !layout.tabs.length) return `${at}.iterm.tabs should be a list with at least one tab`;
  for (const [i, tab] of layout.tabs.entries()) {
    const tp = checkPane(tab, `${at}.iterm.tabs[${i}]`, true);
    if (tp) return tp;
  }
  const focused = layout.tabs.flatMap((tab) => leaves(tab)).filter((pane) => pane.focus).length;
  return focused > 1 ? `${at}.iterm has ${focused} panes with "focus"; only one can have it` : null;
}

function checkPane(pane: unknown, at: string, isTab = false): string | null {
  if (!isObject(pane)) return `${at} should be an object`;
  const p = unknownKey(pane, isTab ? KNOWN.tab : KNOWN.pane, at) ?? strings(pane, ["run", "cwd", "profile", "title"], at);
  if (p) return p;
  if (pane.size !== undefined && !(typeof pane.size === "number" && pane.size > 0)) return `${at}.size should be a number above 0`;
  if (pane.focus !== undefined && typeof pane.focus !== "boolean") return `${at}.focus should be true or false`;
  const splits = ["columns", "rows"].filter((k) => pane[k] !== undefined);
  if (splits.length > 1) return `${at} has both "columns" and "rows"; put one inside the other`;
  if (!splits.length) return null;
  const key = splits[0];
  if (pane.run !== undefined || pane.focus !== undefined) return `${at} is split in ${key}, so "run" and "focus" go on the panes in it`;
  const list = pane[key];
  if (!Array.isArray(list) || list.length < 2) return `${at}.${key} should be a list of at least two panes`;
  for (const [i, child] of list.entries()) {
    const cp = checkPane(child, `${at}.${key}[${i}]`);
    if (cp) return cp;
  }
  return null;
}

/** The panes that aren't split, left to right and top to bottom. */
export function leaves(pane: Pane): Pane[] {
  const split = pane.columns ?? pane.rows;
  return split ? split.flatMap(leaves) : [pane];
}

/** The name of the item called `name`, or of the only one starting like it; else the names it could be. */
export function find(items: Record<string, unknown>, name: string): { name: string } | { could: string[] } {
  if (Object.hasOwn(items, name)) return { name };
  const could = Object.keys(items).filter((key) => key.toLowerCase().startsWith(name.toLowerCase()));
  return could.length === 1 ? { name: could[0] } : { could };
}

export const defaultScript = (ws: Workspace) => ws.default ?? Object.keys(ws.scripts)[0];

/** Writes the example config, unless there's a config already; returns whether it did. */
export function writeExample(file = configFile()): boolean {
  if (existsSync(file)) return false;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, readFileSync(new URL("../examples/config.json", import.meta.url), "utf8"));
  return true;
}

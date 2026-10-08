// The picker `rig` shows without arguments: every workspace with its scripts as cards, styled like punch.

import { defaultScript, tildify, type Config, type Script } from "./config.ts";
import { closeScreen, contentWidth, footer, openScreen, paint, screenHeight, type Key } from "./term.ts";
import { fill, lineLen, shorten, theme, type Line } from "./theme.ts";

export interface Choice {
  workspace: string;
  script: string;
}

type Row =
  | { kind: "workspace"; name: string; description?: string }
  | { kind: "rule" }
  | { kind: "script"; choice: Choice; script: Script; isDefault: boolean; index: number; nameWidth: number }
  | { kind: "gap" };

/** Rows above the list: the header and a blank line. */
const LIST_TOP = 2;
/** Rows below the list: a blank line and the key hints. */
const FOOTER = 2;
const KEYS: [string, string][] = [["⏎", "run"], ["↑↓", "move"], ["q", "quit"]];

/** What a script does, in a few words. */
export function summary(script: Script): string {
  if (script.run) return script.run;
  const tabs = script.iterm!.tabs;
  return `iTerm2: ${tabs.map((tab, i) => tab.title ?? `tab ${i + 1}`).join(", ")}`;
}

export class Picker {
  readonly rows: Row[] = [];
  readonly choices: Choice[] = [];
  sel = 0;
  scroll = 0;

  readonly config: Config;
  readonly file: string;

  constructor(config: Config, file: string) {
    this.config = config;
    this.file = file;
    for (const [name, ws] of Object.entries(config.workspaces)) {
      if (this.rows.length) this.rows.push({ kind: "gap" });
      this.rows.push({ kind: "workspace", name, description: ws.description }, { kind: "rule" });
      const nameWidth = Math.max(...Object.keys(ws.scripts).map((s) => s.length));
      for (const [sname, script] of Object.entries(ws.scripts)) {
        const choice = { workspace: name, script: sname };
        this.rows.push({ kind: "script", choice, script, isDefault: sname === defaultScript(ws), index: this.choices.length,
          nameWidth });
        this.choices.push(choice);
      }
    }
  }

  /** Shows the picker until a script is picked (or null when quit), and gives the terminal back. */
  pick(): Promise<Choice | null> {
    return new Promise((done) => {
      const finish = (choice: Choice | null) => {
        closeScreen();
        done(choice);
      };
      openScreen((_str, key) => this.key(key, finish), () => this.draw());
    });
  }

  key(key: Key, finish: (choice: Choice | null) => void) {
    const last = this.choices.length - 1;
    switch (key.name) {
      case "up":
      case "k":
        this.sel = Math.max(0, this.sel - 1);
        return;
      case "down":
      case "j":
        this.sel = Math.min(last, this.sel + 1);
        return;
      case "home":
      case "g":
        this.sel = 0;
        return;
      case "end":
        this.sel = last;
        return;
      case "return":
      case "enter":
        return finish(this.choices[this.sel]);
      case "escape":
      case "q":
        return finish(null);
    }
    if (key.sequence === "G") this.sel = last;
  }

  header(): Line {
    const count = Object.keys(this.config.workspaces).length;
    return [[`${theme.icons.logo} `, "accent"], ["rig", "title"],
      [`   ${count} workspace${count === 1 ? "" : "s"}`, "name"], [`   ${tildify(this.file)}`, "dim"]];
  }

  /** A workspace label like punch's day labels: a filled pill while one of its scripts is selected. */
  label(name: string, description: string | undefined, focused: boolean): Line {
    const dot = theme.icons.dot ? `${theme.icons.dot} ` : "";
    const text: Line = focused ? [[` ${dot}${name.toUpperCase()} `, "pill"]] : [[dot, "info"], [name.toUpperCase(), "title+info"]];
    return description ? [...text, [`  ${description}`, "name"]] : text;
  }

  /** A script as a card: its name, what it does, and whether it's the workspace's default. */
  card(row: Extract<Row, { kind: "script" }>, selected: boolean, width: number): Line {
    const base = selected ? "cardsel" : "card";
    const lead: Line = [[selected ? theme.icons.barSel : theme.icons.bar, `${base}+${selected ? "info" : "track"}`], [" ", base]];
    const name: Line = [[row.choice.script.padEnd(row.nameWidth), selected ? `${base}+title` : base]];
    const tag: Line = row.isDefault ? [[" default ", `${base}+dim`]] : [];
    const room = width - lineLen(lead) - lineLen(name) - lineLen(tag) - 2;
    const about = row.script.description ?? summary(row.script);
    const text: Line = room > 4 ? [["  ", base], [shorten(about, room), `${base}+name`]] : [];
    return [...fill([...lead, ...name, ...text], width - lineLen(tag), base), ...tag];
  }

  draw() {
    const width = contentWidth();
    const height = screenHeight();
    const out: Line[] = [this.header(), []];
    const room = Math.max(1, height - LIST_TOP - FOOTER);
    const selRow = this.rows.findIndex((r) => r.kind === "script" && r.index === this.sel);
    // Scrolled so the selected script and, when it's the first, its workspace's label are on screen.
    const want = this.rows[selRow - 1]?.kind === "rule" ? selRow - 2 : selRow;
    if (want < this.scroll) this.scroll = want;
    if (selRow >= this.scroll + room) this.scroll = selRow - room + 1;
    this.scroll = Math.max(0, Math.min(this.scroll, this.rows.length - room));
    const current = this.choices[this.sel]?.workspace;
    for (const row of this.rows.slice(this.scroll, this.scroll + room)) {
      if (row.kind === "gap") out.push([]);
      else if (row.kind === "rule") out.push([["─".repeat(width), "rule"]]);
      else if (row.kind === "workspace") out.push(this.label(row.name, row.description, row.name === current));
      else out.push(this.card(row, row.index === this.sel, width));
    }
    while (out.length < height - 1) out.push([]);
    out[height - 1] = footer(KEYS, width);
    paint(out);
  }
}

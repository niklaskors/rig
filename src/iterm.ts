// Opening a layout in iTerm2: the tabs and panes become an AppleScript that osascript runs.
//
// A split pane is made by splitting its first session once per extra pane, then sized, and only then are the
// panes inside split further, so each split only ever cuts the session it belongs to.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expand, type Layout, type Pane } from "./config.ts";

const execFileP = promisify(execFile);

export const appleString = (s: string) => `"${s.replace(/[\\"]/g, "\\$&")}"`;
export const shellQuote = (s: string) => (/^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`);

/**
 * Shell code that gives the tab its title and keeps it. iTerm2 can't set a tab's title from AppleScript (it fails),
 * so the shell sets it; oh-my-zsh sets the title at every prompt unless DISABLE_AUTO_TITLE is true.
 */
const setTitle = (title: string) =>
  `DISABLE_AUTO_TITLE=true; printf '\\033]0;%s\\007' ${shellQuote(title.replace(/[\x00-\x1f\x7f]/g, " "))}; `;

/** What is typed into a pane: set the tab's title, go to the pane's folder, then run its command. */
export const paneLine = (cwd: string, run?: string, title?: string) =>
  `${title ? setTitle(title) : ""}cd ${shellQuote(cwd)} && ${run ?? "clear"}`;

/**
 * The AppleScript that opens the layout; panes start in `cwd` unless they say otherwise.
 *
 * iTerm2 splits a session in half, and setting a pane's columns or rows from AppleScript resizes the whole window
 * around it rather than moving a divider. So each pane is first given its share of the tab's size (the window
 * grows or shrinks to fit), and then the window gets its frame back, which scales every pane by the same amount.
 */
export function layoutScript(layout: Layout, cwd: string): string {
  const out: string[] = [];
  const typed: string[] = [];
  let focus: { tab: string; session: string } | null = null;
  let count = 0;
  const session = () => `s${++count}`;
  const using = (profile?: string) => (profile ? `profile ${appleString(profile)}` : "default profile");
  const round = (n: number) => +n.toFixed(4);

  /** Splits the pane's session `s` as the layout says; returns its panes with their share of the tab's width and height. */
  function build(pane: Pane, s: string, tab: string, title: string | undefined, dir: string, profile: string | undefined,
    share = { w: 1, h: 1 }): { session: string; w: number; h: number }[] {
    dir = pane.cwd ? expand(pane.cwd, dir) : dir;
    profile = pane.profile ?? profile;
    const split = pane.columns ?? pane.rows;
    if (!split) {
      typed.push(`tell ${s} to write text ${appleString(paneLine(dir, pane.run, title))}`);
      if (pane.focus) focus = { tab, session: s };
      return [{ session: s, ...share }];
    }
    const how = pane.columns ? "vertically" : "horizontally";
    const sessions = [s];
    for (const child of split.slice(1)) {
      const next = session();
      out.push(`tell ${sessions.at(-1)} to set ${next} to (split ${how} with ${using(child.profile ?? profile)})`);
      sessions.push(next);
    }
    const whole = split.reduce((sum, child) => sum + (child.size ?? 1), 0);
    return split.flatMap((child, i) => {
      const part = (child.size ?? 1) / whole;
      const childShare = pane.columns ? { w: share.w * part, h: share.h } : { w: share.w, h: share.h * part };
      return build(child, sessions[i], tab, title, dir, profile, childShare);
    });
  }

  layout.tabs.forEach((tab, i) => {
    const t = `t${i + 1}`;
    const profile = tab.profile ?? layout.profile;
    if (i === 0) {
      // iTerm2 opens a window of its own when it starts; that one is used rather than adding another.
      out.push(
        `if fresh and (count of windows) > 0 then`,
        `  set w to current window`,
        `  set ${t} to current tab of w`,
        ...(layout.window === "current"
          ? [`else if (count of windows) > 0 then`, `  set w to current window`, `  tell w to set ${t} to (create tab with ${using(profile)})`]
          : []),
        `else`,
        `  set w to (create window with ${using(profile)})`,
        `  set ${t} to current tab of w`,
        `  delay 0.3`, // a window manager may still be placing it
        ...(layout.zoom ? [`  set zoomed of w to true`, `  delay 0.5`] : []),
        `end if`,
        `set winBox to bounds of w`,
      );
    } else {
      out.push(`tell w to set ${t} to (create tab with ${using(profile)})`);
    }
    const s = session();
    out.push(`set ${s} to current session of ${t}`);
    if (!tab.columns && !tab.rows) return build(tab, s, t, tab.title, cwd, profile);
    out.push(`set tabColumns to columns of ${s}`, `set tabRows to rows of ${s}`);
    const panes = build(tab, s, t, tab.title, cwd, profile);
    // A window in full screen can't be resized; its panes keep the halves iTerm2 made.
    out.push(`try`);
    for (const pane of panes) {
      out.push(
        `  set columns of ${pane.session} to (round (tabColumns * ${round(pane.w)}))`,
        `  set rows of ${pane.session} to (round (tabRows * ${round(pane.h)}))`,
      );
    }
    out.push(`  set bounds of w to winBox`, `end try`);
  });

  const { tab, session: s } = focus ?? { tab: "t1", session: "s1" };
  return [
    `set fresh to not (application "iTerm" is running)`,
    `tell application "iTerm"`,
    `  activate`,
    `  if fresh then delay 1`,
    ...[...out, ...typed, `tell ${tab} to select`, `tell ${s} to select`].map((line) => `  ${line}`),
    `end tell`,
  ].join("\n");
}

/** Opens the layout in iTerm2. */
export async function openLayout(layout: Layout, cwd: string): Promise<void> {
  if (process.platform !== "darwin") throw new Error("iTerm2 layouts need macOS");
  try {
    await execFileP("osascript", ["-e", layoutScript(layout, cwd)]);
  } catch (err) {
    const stderr = String((err as { stderr?: string }).stderr ?? (err as Error).message).trim();
    if (/-1743|not authori[sz]ed/i.test(stderr)) {
      throw new Error("this terminal may not control iTerm2: allow it in System Settings › Privacy & Security › Automation");
    }
    throw new Error(`osascript: ${stderr}`);
  }
}

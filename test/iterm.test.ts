import { describe, expect, it } from "vitest";
import { layoutScript, paneLine, shellQuote } from "../src/iterm.ts";

/** The script's statements, trimmed, so tests can look for whole lines. */
const lines = (script: string) => script.split("\n").map((line) => line.trim());

describe("paneLine", () => {
  it("goes to the folder and runs the command, or clears the screen", () => {
    expect(paneLine("/src/app", "nvim")).toBe("cd /src/app && nvim");
    expect(paneLine("/my code", undefined)).toBe("cd '/my code' && clear");
  });

  it("sets the tab's title first, quoted for the shell", () => {
    expect(paneLine("/x", "ls", "it's")).toBe(`DISABLE_AUTO_TITLE=true; printf '\\033]0;%s\\007' 'it'\\''s'; cd /x && ls`);
  });
});

it("shellQuote leaves plain words alone", () => {
  expect(shellQuote("/a/b-c.d")).toBe("/a/b-c.d");
  expect(shellQuote("a b")).toBe("'a b'");
});

describe("layoutScript", () => {
  it("opens a single pane in a new window, reusing the window iTerm2 opens when it starts", () => {
    const script = lines(layoutScript({ tabs: [{ run: "htop" }] }, "/home"));
    expect(script[0]).toBe('set fresh to not (application "iTerm" is running)');
    expect(script).toContain("if fresh and (count of windows) > 0 then");
    expect(script).toContain("set w to (create window with default profile)");
    expect(script.join("\n")).not.toMatch(/tabColumns/);
    expect(script).toContain('tell s1 to write text "cd /home && htop"');
    expect(script.join("\n")).not.toMatch(/split/);
  });

  it("adds tabs to the current window when asked", () => {
    const script = lines(layoutScript({ window: "current", tabs: [{}, {}] }, "/"));
    expect(script).toContain("else if (count of windows) > 0 then");
    expect(script).toContain("tell w to set t1 to (create tab with default profile)");
    expect(script).toContain("tell w to set t2 to (create tab with default profile)");
  });

  it("zooms a new window to fill the screen", () => {
    expect(lines(layoutScript({ zoom: true, tabs: [{}] }, "/"))).toContain("set zoomed of w to true");
  });

  it("splits panes and gives each its share of the tab, then puts the window's frame back", () => {
    const script = lines(layoutScript({
      tabs: [{ columns: [{ run: "nvim", size: 3 }, { rows: [{ run: "claude", size: 2 }, { run: "git status" }] }] }],
    }, "/repo"));
    expect(script).toContain("tell s1 to set s2 to (split vertically with default profile)");
    expect(script).toContain("tell s2 to set s3 to (split horizontally with default profile)");
    expect(script).toContain("set columns of s1 to (round (tabColumns * 0.75))");
    expect(script).toContain("set rows of s1 to (round (tabRows * 1))");
    expect(script).toContain("set columns of s2 to (round (tabColumns * 0.25))");
    expect(script).toContain("set rows of s2 to (round (tabRows * 0.6667))");
    expect(script).toContain("set rows of s3 to (round (tabRows * 0.3333))");
    // the frame goes back after every pane is sized, and before anything is typed
    const restore = script.indexOf("set bounds of w to winBox");
    expect(restore).toBeGreaterThan(script.indexOf("set rows of s3 to (round (tabRows * 0.3333))"));
    expect(restore).toBeLessThan(script.indexOf('tell s1 to write text "cd /repo && nvim"'));
    expect(script).toContain('tell s3 to write text "cd /repo && git status"');
  });

  it("splits each new pane off the last one, so three columns sit side by side", () => {
    const script = lines(layoutScript({ tabs: [{ columns: [{}, {}, {}] }] }, "/"));
    expect(script).toContain("tell s1 to set s2 to (split vertically with default profile)");
    expect(script).toContain("tell s2 to set s3 to (split vertically with default profile)");
    expect(script).toContain("set columns of s3 to (round (tabColumns * 0.3333))");
  });

  it("resolves folders against the pane they're in, and expands ~", () => {
    const script = layoutScript({ tabs: [{ cwd: "repo", columns: [{ cwd: "web", run: "a" }, { cwd: "~/x", run: "b" }] }] }, "/work");
    expect(script).toContain('write text "cd /work/repo/web && a"');
    expect(script).toMatch(/write text "cd \/.+\/x && b"/);
    expect(script).not.toContain("~");
  });

  it("titles every pane in a tab, and uses profiles from the layout, tab or pane", () => {
    const script = lines(layoutScript({
      profile: "Work",
      tabs: [{ title: "board", columns: [{ run: "a" }, { run: "b", profile: "Logs" }] }, { profile: "Light" }],
    }, "/"));
    expect(script).toContain('set w to (create window with profile "Work")');
    expect(script).toContain('tell s1 to set s2 to (split vertically with profile "Logs")');
    expect(script).toContain('tell w to set t2 to (create tab with profile "Light")');
    expect(script.filter((l) => l.includes("printf") && l.includes(" board; "))).toHaveLength(2);
  });

  it("selects the pane with focus, else the first", () => {
    const focused = lines(layoutScript({ tabs: [{}, { columns: [{}, { focus: true }] }] }, "/"));
    expect(focused.slice(-3)).toEqual(["tell t2 to select", "tell s3 to select", "end tell"]);
    expect(lines(layoutScript({ tabs: [{}, {}] }, "/")).slice(-3)).toEqual(["tell t1 to select", "tell s1 to select", "end tell"]);
  });

  it("escapes text for AppleScript", () => {
    expect(layoutScript({ tabs: [{ run: 'echo "hi" \\ there' }] }, "/")).toContain('write text "cd / && echo \\"hi\\" \\\\ there"');
  });
});

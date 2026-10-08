import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { check, find, leaves, readConfig, type Pane } from "../src/config.ts";

const layout = (tabs: unknown[], extra = {}) => ({ workspaces: { w: { scripts: { s: { iterm: { tabs, ...extra } } } } } });

describe("check", () => {
  it("accepts the example config", () => {
    const file = new URL("../examples/config.json", import.meta.url);
    expect(readConfig(file.pathname)).not.toBeNull();
  });

  it("accepts a command script", () => {
    expect(check({ workspaces: { w: { scripts: { s: { run: "ls" } } } } })).toBeNull();
  });

  it("says where a mistake is", () => {
    expect(check({})).toMatch(/workspaces/);
    expect(check({ workspaces: { w: { scripts: {} } } })).toBe("workspaces.w.scripts should be an object with at least one script");
    expect(check({ workspaces: { w: { scripts: { s: {} } } } })).toBe('workspaces.w.scripts.s needs either "run" (a command) or "iterm" (a layout)');
    expect(check({ workspaces: { w: { scripts: { s: { run: "ls", iterm: { tabs: [{}] } } } } } })).toMatch(/either/);
    expect(check({ workspaces: { w: { default: "x", scripts: { s: { run: "ls" } } } } })).toMatch(/default is "x"/);
    expect(check(layout([]))).toMatch(/tabs should be a list with at least one tab/);
    expect(check(layout([{ colums: [] }]))).toBe(
      'workspaces.w.scripts.s.iterm.tabs[0] has "colums", which rig doesn\'t know (it knows title, run, cwd, size, focus, profile, columns, rows)');
    expect(check(layout([{ columns: [{ run: "a" }] }]))).toMatch(/columns should be a list of at least two panes/);
    expect(check(layout([{ columns: [{}, { size: 0 }] }]))).toBe("workspaces.w.scripts.s.iterm.tabs[0].columns[1].size should be a number above 0");
    expect(check(layout([{ columns: [{}, {}], rows: [{}, {}] }]))).toMatch(/both "columns" and "rows"/);
    expect(check(layout([{ run: "x", columns: [{}, {}] }]))).toMatch(/"run" and "focus" go on the panes in it/);
    expect(check(layout([{ columns: [{ focus: true }, { focus: true }] }]))).toMatch(/2 panes with "focus"/);
    expect(check(layout([{}], { window: "other" }))).toMatch(/window should be "new" or "current"/);
    expect(check(layout([{ run: 1 }]))).toMatch(/tabs\[0\].run should be text/);
  });
});

describe("readConfig", () => {
  it("is null without a config, and names the file when it's broken", () => {
    const dir = mkdtempSync(join(tmpdir(), "rig-test-"));
    try {
      expect(readConfig(join(dir, "none.json"))).toBeNull();
      writeFileSync(join(dir, "bad.json"), "{ nope");
      expect(() => readConfig(join(dir, "bad.json"))).toThrow(/bad\.json isn't valid JSON/);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});

describe("find", () => {
  const items = { acme: 1, home: 2, hobby: 3 };
  it("takes a whole name, or the start of one when it's the only match", () => {
    expect(find(items, "acme")).toEqual({ name: "acme" });
    expect(find(items, "AC")).toEqual({ name: "acme" });
    expect(find(items, "ho")).toEqual({ could: ["home", "hobby"] });
    expect(find(items, "x")).toEqual({ could: [] });
  });
});

it("leaves lists the panes that aren't split, in order", () => {
  const tab: Pane = { columns: [{ run: "a" }, { rows: [{ run: "b" }, { run: "c" }] }] };
  expect(leaves(tab).map((p) => p.run)).toEqual(["a", "b", "c"]);
});

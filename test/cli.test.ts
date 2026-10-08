// The real rig command: run plainly for listing, dry runs, commands and errors, and in a pseudo-terminal
// (node-pty, read through a headless xterm.js) for the picker.

import { spawn as spawnPty, type IPty } from "@lydell/node-pty";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import xterm from "@xterm/headless";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = resolve(import.meta.dirname, "../bin/rig.ts");

let home: string;

beforeEach(() => {
  home = realpathSync(mkdtempSync(join(tmpdir(), "rig-test-")));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const env = (extra: Record<string, string> = {}) =>
  ({ PATH: process.env.PATH ?? "", HOME: home, SHELL: "/bin/sh", TERM: "xterm-256color", ...extra });

function writeConfig(config: unknown) {
  mkdirSync(join(home, ".config", "rig"), { recursive: true });
  writeFileSync(join(home, ".config", "rig", "config.json"), JSON.stringify(config));
}

function rig(...args: string[]) {
  const res = spawnSync(process.execPath, [BIN, ...args], { env: env({ EDITOR: "true" }), encoding: "utf8" });
  return { code: res.status, out: res.stdout, err: res.stderr };
}

const CONFIG = {
  workspaces: {
    acme: {
      description: "Work",
      cwd: "~",
      default: "start",
      scripts: {
        hello: { run: "echo \"hello from $RIG_WORKSPACE/$RIG_SCRIPT in $(pwd)\"; exit 3" },
        start: { description: "The usual tabs", iterm: { tabs: [{ title: "code", columns: [{ run: "nvim" }, { run: "claude" }] }] } },
      },
    },
    home: { scripts: { blog: { cwd: "/tmp", run: "echo blog" } } },
  },
};

describe("rig", () => {
  it("says how to start without a config, and makes an example with --edit", () => {
    expect(rig()).toMatchObject({ code: 1, err: expect.stringContaining("run rig --edit") });
    expect(rig("--edit")).toMatchObject({ code: 0, err: expect.stringContaining("made an example config") });
    const made = readFileSync(join(home, ".config", "rig", "config.json"), "utf8");
    expect(made).toBe(readFileSync(resolve(import.meta.dirname, "../examples/config.json"), "utf8"));
    expect(rig("--edit").err).toBe(""); // there's one now, so it's left alone
  });

  it("lists workspaces and scripts, marking the defaults", () => {
    writeConfig(CONFIG);
    expect(rig("-l").out).toBe([
      "acme  Work",
      "    hello  echo \"hello from $RIG_WORKSPACE/$RIG_SCRIPT in $(pwd)\"; exit 3",
      "  * start  The usual tabs",
      "home",
      "  * blog  echo blog",
      "",
    ].join("\n"));
  });

  it("runs a command script in its folder, with its exit code", () => {
    writeConfig(CONFIG);
    const res = rig("acme", "hel");
    expect(res.out.trim()).toBe(`hello from acme/hello in ${home}`);
    expect(res.code).toBe(3);
  });

  it("shows a dry run: the AppleScript of a layout, the workspace's default script", () => {
    writeConfig(CONFIG);
    const { out, code } = rig("ac", "-n");
    expect(code).toBe(0);
    expect(out).toContain("tell application \"iTerm\"");
    expect(out).toContain(`write text "DISABLE_AUTO_TITLE=true; printf '\\\\033]0;%s\\\\007' code; cd ${home} && nvim"`);
    expect(rig("home", "-n").out).toBe("cd /tmp && echo blog\n");
  });

  it("says what it doesn't know, or when a name could be more than one", () => {
    writeConfig({ workspaces: { ...CONFIG.workspaces, homelab: CONFIG.workspaces.home } });
    expect(rig("nope")).toMatchObject({ code: 2, err: "rig: no workspace \"nope\"; there are: acme, home, homelab\n" });
    expect(rig("ho")).toMatchObject({ code: 2, err: "rig: \"ho\" could be the workspace home, homelab\n" });
    expect(rig("home", "x")).toMatchObject({ code: 2, err: "rig: no script in home \"x\"; there are: blog\n" });
    expect(rig("a", "b", "c").code).toBe(2);
  });

  it("names the config file and the mistake when the config is wrong", () => {
    writeConfig({ workspaces: { acme: { scripts: { s: { run: "x", extra: 1 } } } } });
    expect(rig("-l")).toMatchObject({
      code: 1,
      err: "rig: ~/.config/rig/config.json: workspaces.acme.scripts.s has \"extra\", which rig doesn't know (it knows description, cwd, run, iterm)\n",
    });
  });

  it("stops when a script's folder doesn't exist", () => {
    writeConfig({ workspaces: { w: { cwd: "~/gone", scripts: { s: { run: "true" } } } } });
    expect(rig("w")).toMatchObject({ code: 1, err: "rig: w s: its folder ~/gone doesn't exist\n" });
  });
});

describe("the picker", () => {
  const COLS = 80;
  const ROWS = 24;
  let pty: IPty;
  let term: InstanceType<typeof xterm.Terminal>;
  let exited: Promise<number>;

  const text = () => {
    const buffer = term.buffer.active;
    return Array.from({ length: ROWS }, (_, y) => buffer.getLine(y)?.translateToString(true) ?? "").join("\n");
  };

  async function waitFor(what: string) {
    const until = Date.now() + 5000;
    while (!text().includes(what)) {
      if (Date.now() > until) throw new Error(`Timed out waiting for ${what}; the screen shows:\n${text()}`);
      await new Promise((r) => setTimeout(r, 20));
    }
  }

  async function type(...keys: string[]) {
    for (const key of keys) {
      pty.write(key);
      await new Promise((r) => setTimeout(r, 40));
    }
  }

  function start(...args: string[]) {
    term = new xterm.Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
    pty = spawnPty(process.execPath, [BIN, ...args], { cols: COLS, rows: ROWS, env: env({ COLORTERM: "truecolor" }) });
    pty.onData((data) => term.write(data));
    exited = new Promise((done) => pty.onExit(({ exitCode }) => done(exitCode)));
  }

  it("shows every workspace with its scripts, and runs the one picked", async () => {
    writeConfig(CONFIG);
    start();
    await waitFor("ACME");
    const screen = text();
    expect(screen).toContain("rig   2 workspaces");
    expect(screen).toMatch(/ACME\s+Work/);
    expect(screen).toMatch(/start\s+The usual tabs\s+default/);
    expect(screen).toContain("HOME");
    expect(screen).toMatch(/run.+move.+quit/);

    await type("j", "j", "\r"); // hello, start, blog
    await waitFor("blog");
    expect(await exited).toBe(0);
    expect(text()).toContain("blog");
    expect(text()).not.toContain("ACME"); // the full screen is gone
  });

  it("quits with q without running anything", async () => {
    writeConfig(CONFIG);
    start();
    await waitFor("ACME");
    await type("q");
    expect(await exited).toBe(0);
  });
});

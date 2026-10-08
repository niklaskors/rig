// Running a script: a shell command in this terminal, or a layout opened in iTerm2.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { expand, tildify, type Script, type Workspace } from "./config.ts";
import { layoutScript, openLayout } from "./iterm.ts";

/** Where the script starts: its own cwd, else its workspace's, else the home folder. */
export function scriptCwd(ws: Workspace, script: Script): string {
  const base = ws.cwd ? expand(ws.cwd, homedir()) : homedir();
  return script.cwd ? expand(script.cwd, base) : base;
}

/** What running the script does, without doing it: the command, or the AppleScript of the layout. */
export function describe(ws: Workspace, script: Script): string {
  const cwd = scriptCwd(ws, script);
  return script.iterm ? layoutScript(script.iterm, cwd) : `cd ${cwd} && ${script.run}`;
}

/** Runs the script; resolves with the exit code. */
export async function runScript(workspace: string, ws: Workspace, name: string, script: Script): Promise<number> {
  const cwd = scriptCwd(ws, script);
  if (!existsSync(cwd)) throw new Error(`its folder ${tildify(cwd)} doesn't exist`);
  if (script.iterm) {
    await openLayout(script.iterm, cwd);
    return 0;
  }
  const child = spawn(script.run!, {
    shell: process.env.SHELL || true,
    cwd,
    stdio: "inherit",
    env: { ...process.env, RIG_WORKSPACE: workspace, RIG_SCRIPT: name },
  });
  return new Promise((done, fail) => {
    child.on("error", fail);
    child.on("exit", (code, signal) => done(code ?? (signal ? 128 : 1)));
  });
}

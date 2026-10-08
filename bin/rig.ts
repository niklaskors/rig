#!/usr/bin/env node
// rig: scripts grouped per workspace; open a whole iTerm2 layout, or run any command, with one word.

import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { ConfigError, configFile, defaultScript, find, readConfig, tildify, writeExample, type Config } from "../src/config.ts";
import { Picker, summary } from "../src/picker.ts";
import { describe, runScript } from "../src/run.ts";
import { THEME_NAMES, useTheme } from "../src/theme.ts";

const USAGE = `Usage: rig [WORKSPACE [SCRIPT]] [options]

Scripts grouped per workspace: open a layout of iTerm2 tabs and panes, or run any
command, with one word.

  rig                    pick a workspace and script from a list
  rig WORKSPACE          run the workspace's default script
  rig WORKSPACE SCRIPT   run that script; the start of a name is enough

  -l, --list       list the workspaces and their scripts
  -n, --dry-run    show what would run (for a layout, its AppleScript), without running it
  --edit           open the config in $EDITOR, after making an example one if there's none
  -t, --theme      night (default, dark), day (light terminals) or classic (16 colours)
  -h, --help       show this

Environment:
  RIG_CONFIG       the config file to use
  RIG_THEME        night, day or classic`;

const die = (message: string, code = 1): never => {
  console.error(`rig: ${message}`);
  process.exit(code);
};

function args() {
  try {
    return parseArgs({
      allowPositionals: true,
      options: {
        list: { type: "boolean", short: "l" },
        "dry-run": { type: "boolean", short: "n" },
        edit: { type: "boolean" },
        theme: { type: "string", short: "t" },
        help: { type: "boolean", short: "h" },
      },
    });
  } catch (err) {
    return die(`${(err as Error).message}\n\n${USAGE}`, 2);
  }
}
const { values, positionals } = args();
if (positionals.length > 2) die(`too many arguments\n\n${USAGE}`, 2);

const file = configFile();
if (values.help) {
  console.log(`${USAGE}\n\nThe config is ${tildify(file)}`);
  process.exit(0);
}

if (values.edit) {
  const made = writeExample(file);
  if (made) console.error(`rig: made an example config in ${tildify(file)}`);
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const res = spawnSync(`${editor} "$RIG_FILE"`, { shell: true, stdio: "inherit", env: { ...process.env, RIG_FILE: file } });
  process.exit(res.status ?? 1);
}

const themeName = values.theme ?? process.env.RIG_THEME ?? "night";
if (!useTheme(themeName)) die(`unknown theme "${themeName}", choose from: ${THEME_NAMES.join(", ")}`, 2);

function load(): Config | null {
  try {
    return readConfig(file);
  } catch (err) {
    if (err instanceof ConfigError) die(err.message);
    throw err;
  }
}
const config = load() ?? die(`there's no config yet in ${tildify(file)}; run rig --edit to start from an example`);
if (!Object.keys(config.workspaces).length) die(`${tildify(file)} has no workspaces yet; rig --edit to add one`);

if (values.list) {
  for (const [name, ws] of Object.entries(config.workspaces)) {
    console.log(ws.description ? `${name}  ${ws.description}` : name);
    const width = Math.max(...Object.keys(ws.scripts).map((s) => s.length));
    for (const [sname, script] of Object.entries(ws.scripts)) {
      const mark = sname === defaultScript(ws) ? "*" : " ";
      console.log(`  ${mark} ${sname.padEnd(width)}  ${script.description ?? summary(script)}`);
    }
  }
  process.exit(0);
}

/** The item by its name or the start of it, or a clear error. */
function pick(items: Record<string, unknown>, name: string, what: string): string {
  const found = find(items, name);
  if ("name" in found) return found.name;
  if (found.could.length) die(`"${name}" could be the ${what} ${found.could.join(", ")}`, 2);
  return die(`no ${what} "${name}"; there are: ${Object.keys(items).join(", ")}`, 2);
}

let workspace: string, script: string;
if (positionals.length) {
  workspace = pick(config.workspaces, positionals[0], "workspace");
  const ws = config.workspaces[workspace];
  script = positionals[1] ? pick(ws.scripts, positionals[1], `script in ${workspace}`) : defaultScript(ws);
} else {
  const choice = await new Picker(config, file).pick();
  if (!choice) process.exit(0);
  ({ workspace, script } = choice);
}

const ws = config.workspaces[workspace];
const chosen = ws.scripts[script];
if (values["dry-run"]) {
  console.log(describe(ws, chosen));
  process.exit(0);
}
try {
  if (chosen.iterm) console.error(`rig: opening ${workspace} ${script} in iTerm2`);
  process.exitCode = await runScript(workspace, ws, script, chosen);
} catch (err) {
  die(`${workspace} ${script}: ${(err as Error).message}`);
}

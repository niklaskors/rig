# rig

Your scripts, grouped per workspace. `rig work` opens your whole working setup: an iTerm2 window with the tabs and
panes you described, each one in the right folder and running the right program. Scripts can also be any shell
command, like pulling every repo.

```sh
rig                 # pick a workspace and script from a list
rig work            # run the work workspace's default script
rig work pull       # run its pull script
rig w p             # the start of a name is enough
```

- **Layouts as data**: tabs are split into `columns` and `rows`, as deep as you like, each pane with its own
  command, folder and share of the space
- **Workspaces**: group scripts for a client, a job or a side project; each has its own folder and default script
- **Look before you run**: `rig work -n` prints what would run, for a layout the AppleScript it hands to iTerm2
- **No build, no dependencies**: TypeScript that Node runs directly, like
  [jboard](https://github.com/niklaskors/jboard), [punch](https://github.com/niklaskors/punch) and
  [bench](https://github.com/niklaskors/bench)

## Install

Needs Node 22.18 or newer, which runs the TypeScript directly. Layouts need iTerm2 on macOS; command scripts run
anywhere.

```sh
git clone git@github.com:niklaskors/rig.git
ln -s "$PWD/rig/bin/rig.ts" ~/.local/bin/rig   # any directory on your PATH
rig --edit                                     # starts you off with an example config
```

The first time a layout opens, macOS asks whether your terminal may control iTerm2. Allow it, or later in System
Settings › Privacy & Security › Automation.

## Config

One JSON file, `~/.config/rig/config.json` (or under `$XDG_CONFIG_HOME`, or wherever `$RIG_CONFIG` says).
`rig --edit` opens it in `$EDITOR`. rig checks it every time it runs, and says where a mistake is.

```json
{
  "workspaces": {
    "work": {
      "description": "The day job",
      "cwd": "~/Developer",
      "default": "start",
      "scripts": {
        "start": {
          "iterm": {
            "zoom": true,
            "tabs": [
              {
                "title": "board",
                "columns": [
                  { "run": "jboard", "size": 3, "focus": true },
                  { "rows": [{ "run": "punch" }, { "cwd": "~" }] }
                ]
              },
              {
                "title": "api",
                "cwd": "api",
                "columns": [{ "run": "nvim", "size": 2 }, { "run": "claude" }]
              }
            ]
          }
        },
        "pull": { "run": "git -C api pull --ff-only" }
      }
    }
  }
}
```

That `start` opens a window filling the screen, with two tabs:

```
board                                   api
┌──────────────────────────┬────────┐   ┌─────────────────────┬───────────┐
│ jboard                   │ punch  │   │ nvim                │ claude    │
│                          ├────────┤   │                     │           │
│                          │ shell  │   │                     │           │
└──────────────────────────┴────────┘   └─────────────────────┴───────────┘
```

**Workspace**

| Key | |
| --- | --- |
| `scripts` | the scripts, by name |
| `default` | the script `rig WORKSPACE` runs; else the first one |
| `cwd` | where its scripts start; else your home folder |
| `description` | shown in the list |

**Script**: either `run` or `iterm`

| Key | |
| --- | --- |
| `run` | a shell command, run in this terminal (`$RIG_WORKSPACE` and `$RIG_SCRIPT` say what's running) |
| `iterm` | a layout to open in iTerm2 |
| `cwd` | where it starts, relative to the workspace's folder |
| `description` | shown in the list |

**Layout** (`iterm`)

| Key | |
| --- | --- |
| `tabs` | the tabs, each a pane with a `title` |
| `window` | `"new"` (default) opens a window; `"current"` adds the tabs to the front window |
| `zoom` | `true` makes a new window fill the screen |
| `profile` | an iTerm2 profile for every pane |

**Pane** (and tab)

| Key | |
| --- | --- |
| `run` | the command typed into the pane; without one, you get a shell |
| `columns` / `rows` | split it instead: a list of panes side by side, or stacked |
| `size` | its share of the split, against the others' (default 1): sizes 2 and 1 make ⅔ and ⅓ |
| `cwd` | where it starts, relative to the pane it's in; `~` works |
| `focus` | `true` for the pane to have the focus once everything is open |
| `profile` | an iTerm2 profile for this pane and the panes in it |
| `title` | the tab's title (tabs only) |

Commands are typed into a normal shell, so your aliases and functions work, and you stay in the pane's shell when
the command ends.

## How layouts open

rig turns the layout into an AppleScript for iTerm2 and runs it with `osascript`. Two iTerm2 quirks shape it:

- Setting a pane's size from AppleScript resizes the whole window rather than moving a divider. So rig gives each
  pane its share, lets the window grow or shrink around them, and then puts the window's frame back, which scales
  every pane by the same amount.
- iTerm2 fails to set a tab's title from AppleScript, so each pane sets it from the shell instead
  (`printf '\033]0;title\007'`, with `DISABLE_AUTO_TITLE=true` for oh-my-zsh).

## Keys in the picker

| Key | |
| --- | --- |
| `↑` `↓` / `k` `j` | move |
| `enter` | run the script |
| `q` / `esc` | quit |

`-t night` (default, dark), `-t day` (light terminals) or `-t classic` (16 colours), or set `RIG_THEME`.

## Development

```sh
npm install      # tools for checking and testing; rig itself has no dependencies
npm run check    # type-check
npm test         # Vitest
```

The tests check the config, the AppleScript a layout becomes, and the real `rig` command, including the picker in a
pseudo-terminal ([node-pty](https://github.com/microsoft/node-pty) and a headless [xterm.js](https://xtermjs.org)).
They never open iTerm2.

## License

MIT

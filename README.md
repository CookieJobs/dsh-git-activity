# dsh-git-activity

English | [中文](README.zh.md)

A DeepSeek Harness (DSH) plugin that answers one question every day:
**what changed recently in each of my projects?**

It reads Git locally and read-only — no GitHub/GitLab account, no network, no tokens — so work
committed by DSH agents, other agents, your editor or your own terminal all lands in the same view.

```
┌ Project activity ───────────────────────────────────────────┐
│ 6 projects · 3 repos · 61 commits (14d) · 52 uncommitted    │
│                                                            │
│ noteWithAI   [main] [7 uncommitted]        14 commits / 14d │
│ /Users/me/work/noteWithAI                                  │
│ docs: specify proactive note continuation agent            │
│ CookieJobs · 32 min ago · abb0b7f                          │
│ ▁▂▃▅▂▁▁▁▁▁▁▁▁▁                                             │
│                                                            │
│ Recent commits                                             │
│ Today   14:03  noteWithAI   docs: spec…        CookieJobs  │
└────────────────────────────────────────────────────────────┘
```

## Why

DSH shows you a Session, not a project. If you also commit from other agents or editors, there is no
single place that says "these are the projects that moved today". This plugin adds that place, plus a
compact status line inside every Session so you never have to leave the conversation to check.

## What you get

| Where | What it shows |
| --- | --- |
| **Sidebar → board icon** | The full board: overview strip, one row per workspace project (branch, ahead/behind, uncommitted count, daily commit histogram, last commit), and a merged commit timeline across all repositories. Switch 7 / 14 / 30-day windows. |
| **Inside a Session** (under the composer) | One line for the current project: branch, uncommitted files, commits in the window, latest commit. Click it to open the detail panel. |
| **New Session page** | A compact branch / uncommitted chip next to the workspace and preset controls, so you know the state before you type. |
| **Right sidebar** | A detail tab for the project: branch and upstream, changed files, daily histogram, and its full commit list. "Open full board" switches to the board. |
| **Agent tool** | `git_activity(days)` returns the same data, so you can just ask the agent what changed. |

Hiding is supported too: projects you do not want to follow can be hidden from the board — they also
drop out of the overview numbers, the timeline and the in-Session strip, and an "N hidden" control
beside the Projects heading restores them one by one or all at once.

## Requirements

- DSH **0.2.2-rc.5** or newer (the Web / Desktop client — this is a UI plugin).
- `git` on `PATH`.
- No dependencies, no build step: the browser half is a plain `window.__ModuleLoader__` module and the
  Host half imports only Node built-ins.

## Install

The plugin is a local DSH bundle, so it lives on disk and the profile links to it.

```sh
git clone https://github.com/CookieJobs/dsh-git-activity.git
```

Then in DSH:

1. **Plugins** → **Add plugin** → choose the cloned `dsh-git-activity` directory.
2. Enable the bundle if it is not enabled yet.
3. Reload the page (⌘R / Ctrl-R). A board icon appears in the sidebar panel-icon list, next to
   *Plugins* and *Schedules*.

Keep the cloned directory where it is: the profile stores a link to it, not a copy.

Uninstalling is symmetric — remove the bundle from **Plugins**. The plugin stores nothing inside the
repository.

## Configuration

Defaults live in `cordis.patch.yml`. To change them, override the same row id in your own
`~/.dsh/profiles/<profile>/cordis.patch.yml` (the override replaces the whole `config` object):

| Key | Default | Meaning |
| --- | --- | --- |
| `days` | `14` | Default commit window, in days |
| `maxCommits` | `30` | Commits returned per repository |
| `historyLimit` | `400` | Commits read per repository when building the histogram |
| `scanChildren` | `true` | When a workspace is not itself a repository, also look for repositories in its direct subdirectories |
| `cacheMs` | `8000` | How long one scan is reused, so polling never re-runs Git |
| `gitTimeoutMs` | `6000` | Timeout for a single Git command |
| `maxReposPerWorkspace` | `16` | Cap on repositories recognised inside one workspace |
| `extraRepos` | `[]` | Absolute paths of repositories outside any workspace to include |

```yaml
- insert:
    - id: git-activity
      name: 'dsh-git-activity'
      config:
        days: 30
        scanChildren: false
        cacheMs: 15000
        extraRepos:
          - /Users/me/work/another-repo
```

## Notes and limitations

- **Read-only.** Only `rev-parse`, `status`, `log` and `rev-list` run, always with
  `--no-optional-locks`, so the plugin never writes to a repository and never fights another agent for
  `index.lock`. Nothing is sent anywhere.
- **Git on `PATH` is required.** When it is missing or a command times out, the affected card shows the
  error instead of pretending there are zero commits.
- **A workspace inside a larger repository is not counted.** Only repositories at or under the
  workspace path belong to that project; a workspace that merely lives inside some big repo (for
  example `~/Documents` accidentally being a repo) shows a hint instead of borrowing that repo's
  history.
- **No network.** Ahead/behind counts compare against the local `@{upstream}` ref; nothing is fetched.
- **Attribution is Git's.** The plugin shows the commit author. It cannot tell which agent made a
  commit, and uncommitted work is only visible as changed files.
- **The hidden list** is stored on the Host at `$DSH_HOME/git-activity/hidden.json` (default
  `~/.dsh/git-activity/hidden.json`), keyed by workspace id. Delete that file to clear it.
- **The right-sidebar tab is per Session**, because DSH persists right-sidebar layouts per Session.

## Development

| File | Role |
| --- | --- |
| `index.js` | Host half: scans workspaces with Git, serves `/git-activity/api/*` behind the GUI's own connection gate, registers the `git_activity` tool |
| `client.js` | Browser half: the board page, the in-Session strip, the New Session chip, and the right-sidebar detail tab |
| `cordis.patch.yml` | The bundle patch that inserts the Host row |
| `locale/en.json`, `locale/zh.json` | Plugin Manager title and description |
| `icon.svg` | Bundle icon |

There is nothing to build. Edit a file, then reinstall the bundle (or reload it from **Plugins**) to
pick the change up.

## License

[MIT](LICENSE)

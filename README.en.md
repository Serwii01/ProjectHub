# ProjectHub

**Your projects and where you left them, within reach of any AI.**

[Español](README.md) · English

ProjectHub is an [MCP](https://modelcontextprotocol.io) server, a CLI and a local dashboard. With it, your AI assistant (Claude, Cursor, Copilot, Gemini, Codex…) knows all your repos by name, knows where each one stands, and tells you what needs doing before touching anything: pull commits from your other computer, log untracked work, leave generated files alone.

It has two goals: **spend fewer tokens** and **let you carry on in another chat or on another computer** without explaining the project again.

> **Language.** The status files written into your repos, and everything the AI tells you, can be in English. The CLI output, the dashboard and the instructions the server gives the AI are still in Spanish; the AI reads them and answers in your language.

## Install

Requirements: **Git** and **Node.js 20+**.

```bash
npm install -g github:Serwii01/ProjectHub
projecthub instalar --idioma en
```

The installer creates `~/.projecthub`, registers the MCP server in every AI client it finds on the machine (Claude Code, Claude Desktop, Cursor, VS Code, Windsurf, Gemini CLI, Antigravity, Codex CLI), and scans your repos. It backs up every file it changes to `~/.projecthub/backups`. Restart your AI client afterwards and ask it “what projects do I have?”.

| Option | What it does |
|---|---|
| `--roots dir1,dir2` | Folders to look for projects in (first level of each). |
| `--github user` | GitHub account whose uncloned repos are listed. |
| `--clientes a,b` | Register only in those clients (`todos` = all, `ninguno` = none). |
| `--equipo name` | What this computer is called in warnings shown on your other computers. |
| `--idioma en` | Create new `STATUS.md` files in English. |
| `--sin-extras` | Skip the Claude Code extras (skills, global rules, hooks). |

For any other MCP client:

```json
{ "mcpServers": { "project-hub": { "command": "projecthub", "args": ["mcp"] } } }
```

## How it works

1. **A status file in each repo.** `STATUS.md` says where the work stands (status, next steps, last sessions, decisions). The context file (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`…) says how the project is built. They travel with git, so they are the same on every computer and for every AI.
2. **An MCP server** that gives the AI access to any project by name, from any folder, and tells it what to do in each situation.
3. **A local dashboard** to see everything at a glance.

Everything runs on your machine. No account, no server, no telemetry.

## Day to day

| When | Say | What happens |
|---|---|---|
| Starting | “What's pending?” | A table of all projects, alerts and a recommendation. |
| Resuming | “Let's resume my-shop” | `git fetch`, warnings, a brief of the status files and the next step. |
| Meanwhile | “How did I do login in my-shop?” | The AI searches your notes and code in other projects. |
| Finishing | “Let's close the session” | Logs what was done in `STATUS.md` and offers to commit and push. |
| Switching chat or computer mid-task | “I'll continue in another chat” | Leaves a handoff with the exact point where the work stopped. |
| Reviewing | “What did I do this week?” | Logged sessions and unlogged commits across all projects. |

## Built to spend few tokens

Everything a tool returns takes up conversation context, so the server answers with the minimum and gives detail only on request.

- **Brief context.** Resuming a project returns the next action, warnings, status, steps and last session. The full `STATUS.md`, the git log or the context file are separate requests.
- **Overview as a table.** One line per project instead of an object with twenty fields.
- **Project map.** `get_project_map` summarises the repo structure so the AI does not explore blindly.
- **Notes before code.** `search` looks first in decisions, known issues and past sessions.
- **Bounded reads.** Files are read by line range and searches return a few matches per project.
- **Status files on a budget.** The hub warns when a `STATUS.md` exceeds about 1,500 tokens and moves old sessions to `HISTORY.md`.
- **Measured.** `projecthub uso` shows the tokens each tool has returned, and the tests enforce limits.

On the author's 23 projects, the overview went from about 13,500 tokens to 1,300, and resuming a project from 2,100 on average to 400.

## Several computers and chats

| What | Where it lives | How it syncs |
|---|---|---|
| Code and status files | In each repo | Push when closing, pull when resuming. The AI offers it. |
| Work in progress | `.projecthub/relevo.md` in the repo | A commit and push that the AI offers when leaving a handoff. |
| Priorities, descriptions, rules | `~/.projecthub/config.json` | `projecthub sync` |
| What is unpushed on each computer | `~/.projecthub/equipos/` | `projecthub sync` |

To turn sync on, create an empty private repo and run on each computer:

```bash
projecthub sync --remote <repo url>
```

From then on, when you resume a project on one computer the AI warns you if another one still has unpushed commits or uncommitted changes for it. The dashboard shows the same warning and has a **Sincronizar** button that pulls and pushes whatever can be fast-forwarded, after showing you the plan.

## MCP tools

| Tool | What it does |
|---|---|
| `list_projects` | Overview table: git state, next step, today's warnings, recommended project, uncloned repos. |
| `get_project_context` | What is needed to resume a project. `contexto` adds the context file; `detalle: "completo"` adds everything. |
| `update_status` | Saves progress to `STATUS.md`. |
| `save_handoff` | Leaves a handoff with unfinished work for another chat or computer. |
| `get_project_map` | The project structure in a few lines. |
| `search`, `read_project_file` | Search notes (or code with `en: "codigo"`) and read files, whole or by line range. |
| `work_report` | What was done in the last days across all projects. |
| `clone_project` | Clones a repo from your account. Git state is `get_project_context` with `detalle: "git"`; priority and description go through `update_status`; `projecthub doctor` checks the installation. |

The server **never commits, pushes, pulls or deletes anything in your projects**. The AI does that with its own tools, asking you first. The two exceptions are explicit: `projecthub sync` for the hub's own configuration folder, and the dashboard's **Sincronizar** button, which you press and confirm.

## Security

- Blocked files: `.env` (except `.env.example`), keys (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `*.jks`), `node_modules/`, `vendor/`, `.git/`.
- No path can leave the project folder.
- The dashboard listens on `127.0.0.1` only, rejects other `Host` headers, and requires a custom header on requests that change anything.
- `clone_project` only clones repos from your own GitHub account.
- The GitHub token lives only in `local.json`, on your machine.

## Development

```bash
git clone https://github.com/Serwii01/ProjectHub.git
cd ProjectHub
npm ci        # exact versions from package-lock.json, without changing it
npm test
```

The code and its comments are in Spanish. See the [Spanish README](README.md) for the full reference: configuration, warnings, CLI and troubleshooting.

## License

[MIT](LICENSE)

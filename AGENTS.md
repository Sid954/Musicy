# AGENTS.md

Instructions for any AI coding agent working in this repo. Read in this order:
1. `CLAUDE.md` - architecture, commands, gotchas (authoritative; keep it updated).
2. `docs/ROADMAP.md` - the feature plan. Work through it top to bottom, one task at a time.

## Project in one paragraph
Self-hosted Discord music bot (YouTube first), CommonJS Node.js, discord.js v14 + @discordjs/voice >= 0.19. Runs 24/7 on a free host with **512MB RAM / 1GB disk**. The author tests locally on Windows 11, deploys to Wispbyte (Linux).

## Hard constraints (do not violate)
- **Memory:** idle < 100MB RSS, playing < 200MB. No new dependency over ~5MB installed without a strong reason. No native modules that need compilers (host has none): prefer pure JS or prebuilt binaries.
- **Disk:** never write audio to disk. Persistent data (settings, playlists) is small JSON or `node:sqlite`; writes are atomic (write temp + rename) and debounced.
- **Pipeline:** `yt-dlp -> ffmpeg (libopus/ogg) -> OggOpus resource`. Do not decode to PCM in JS. Filters/volume/seek are ffmpeg args, applied when a track's stream is spawned.
- **No API keys** beyond the Discord token. Free keyless services only (e.g. lrclib.net, SponsorBlock API, YouTube suggest endpoint).
- **Intents:** keep `Guilds` + `GuildVoiceStates` only unless a task says otherwise. No message-content intent; slash commands only.
- Always kill child processes (yt-dlp, ffmpeg) on skip/stop/leave/error. A leaked process is a bug.
- Windows and Linux must both work (use `path`, no shell-specific spawn strings, `SIGKILL` guarded).

## Workflow for every task
1. Read the task in `docs/ROADMAP.md`, including its acceptance criteria.
2. Implement it following existing patterns (command = `{ data, execute }` entry; replies via `src/embeds.js`; voice state in `GuildQueue`).
3. Add pure-logic unit tests in `tests/` (`node:test`) for anything not requiring Discord (parsers, formatters, queue ops, ffmpeg arg builders). Keep logic in small testable functions, separate from Discord objects.
4. Run `npm run check` and `npm test`. Both must pass.
5. If a command's name/options changed, tell the user to run `npm run deploy`.
6. Update `CLAUDE.md` if architecture changed, and tick the task in `docs/ROADMAP.md`.
7. Voice behaviour cannot be tested by an agent: end the task with a short **manual test checklist** for the user (what to run in Discord, what they should see/hear).
8. Never commit `.env`, `cookies.txt`, `bin/`, `data/`. Don't commit unless asked.

## Conventions
- Errors shown to users are friendly embeds (`embeds.error`); details go to `console.error`. Classify yt-dlp failures (bot-check, age-restricted, unavailable, geo-blocked) into readable messages (see roadmap task 1.1).
- Every `execute` must reply within 3s or `deferReply()` first. Treat all yt-dlp output as untrusted: never interpolate it into shell commands (always `spawn` with an args array) and escape/limit lengths in embeds (title <= 256, description <= 4096, field <= 1024).
- Use `ephemeral: true` for personal/error replies, public for shared state changes.
- Per-guild state lives on `GuildQueue` or in the settings store, never in module-level globals other than the `queues` Map.
- Source modules implement `{ name, canHandle(query), resolve(query), stream(track, opts) }`; `opts` carries `{ seek, filters, volume }`.

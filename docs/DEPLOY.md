# Deploying to a free 24/7 host (Wispbyte and similar)

Limits to respect: **512 MB RAM, 1 GB disk.** Measured on a Windows PC: Node ~80 MB idle (with the memory flags in
`npm start`), yt-dlp ~87 MB while looking a song up, ffmpeg ~20 MB per server that is playing. One server needs
about 215 MB at worst; the project folder is ~150 MB. Linux numbers will differ a little: check `/stats` on the host.

## 1. First deployment
1. Create a **Node.js** server. Upload the project **without** `node_modules`, `data`, `bin` and `.env`
   (or connect a Git repo; `.gitignore` already excludes them).
2. Set the environment variables in the panel (see `.env.example`). Required: `DISCORD_TOKEN`, `CLIENT_ID`.
   Recommended: `BOT_OWNER_ID` (your Discord user ID), `MEMORY_LIMIT_MB=512`.
3. Startup command: `npm install --omit=dev && npm start`
4. Register the slash commands once (from your PC is fine): `npm run deploy`
   Do this again whenever a command is added or its options change.

## 2. Check it before trusting it
In the host's console run:

```
npm run selftest
```

It prints one line per check and ends with `0 error(s)` when everything is fine. It verifies the configuration,
that `discord.js`, the voice encryption library and the bundled ffmpeg are intact, that yt-dlp runs, that ffmpeg can
encode Opus, that Discord and YouTube are reachable, and that a real YouTube lookup works from **this host's IP**.
After the bot is online the same check is available in Discord as `/admin selftest`.

## 3. The two things that commonly go wrong on a host
| Symptom | Cause | Fix |
|---|---|---|
| `YouTube lookup: … sign in (bot check)` | YouTube blocks datacenter IPs | Export cookies from a throwaway YouTube account as `cookies.txt`, upload it, set `YTDLP_COOKIES=cookies.txt`, restart. `/admin cookies` shows whether it worked. |
| `ffmpeg: The bundled ffmpeg binary is missing` | newer npm (11+/12) blocks install scripts ("allowScripts"), so `ffmpeg-static` has no binary | Musicy now downloads it by itself on start (needs internet). If that still fails, run `node node_modules/ffmpeg-static/install.js` in the host console. |
| Bot plays but nobody hears it | server-muted, deafened listener, missing Speak permission | The bot posts a warning for mute / missing permissions. Check Discord's per-user volume for the bot (right-click it). |
| Commands missing in Discord | commands not registered | `npm run deploy` (set `GUILD_ID` for instant registration in one server). |

## 4. Keeping an eye on it
- `/stats` → memory of Node **and** the yt-dlp/ffmpeg helpers against `MEMORY_LIMIT_MB` (🟡 at 70 %, ⚠️ at 85 %).
- `/admin logs` shows the newest log lines. Logs are written to `data/logs/bot.log` (rotated at 2 MB, 3 old files kept,
  so at most ~8 MB). `LOG_FILE=off` disables the file.
- With `BOT_OWNER_ID` set, the bot **DMs you** when the same error repeats (3× in 10 minutes), or 10 different errors
  happen in 10 minutes. Make sure your DMs from server members are allowed.
- If memory ever passes 480 MB the bot exits on purpose; the host's auto-restart (or PM2) brings it back clean.

## 5. Updating
Upload the new files (keep `data/` and `.env`), restart. yt-dlp updates itself every 12 hours and on the first
unexplained lookup failure. Settings, playlists, stats and the 24/7 queue live in `data/` and survive updates.

## 6. Other ways to run it
- **PM2**: `pm2 start ecosystem.config.js` (restarts above 400 MB, uses the same memory flags).
- **Docker**: a `Dockerfile` is included (Node 22 slim, non-root, `npm start`). **It has not been built or run yet**
  (Docker was not available where it was written), so treat it as untested and run `npm run selftest` inside it first.
  Mount `/app/data` to keep settings.

## 7. Memory flags (already in `npm start` and `ecosystem.config.js`)
`--max-old-space-size=256 --max-semi-space-size=1`: measured idle memory 91 → 78 MB and 108 → 78 MB after heavy work,
with no measurable slowdown. If your host launches Node itself, set
`NODE_OPTIONS=--max-old-space-size=256 --max-semi-space-size=1`.

## 8. If the host stops the server for CPU use
Some free hosts stop servers whose average CPU is too high. The biggest CPU use in Musicy is **loudness leveling**: it re-encodes every song (measured: about 2% of one core per playing server on a PC versus 0.1% for passthrough, and a shared host core is slower). To cut it:
- Set `LEVELING_DEFAULT=off` in the panel (new servers start without leveling), or run `/normalize enabled:false` in an existing server. Songs are then passed through without re-encoding.
- Songs from saved playlists now use one short lookup and ffmpeg alone; yt-dlp no longer keeps running for the whole song.
- Idle cost is near zero: the only timers are the 30 s status rotation, 60 s memory/helper checks and 15 s card updates while someone listens.

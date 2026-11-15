# Roadmap

Do tasks in order; each is independently shippable. Format: **ID - name** (effort S/M/L) - what, how, files, acceptance. Tick `[x]` when done. Read `AGENTS.md` constraints first (512MB RAM, ffmpeg-arg-based features, no keys).

---

## Phase 0 - Foundations (do first; later phases depend on these)

- [x] **0.1 - Split commands into files (S).** Replace the single array in `src/commands/index.js` with one file per command in `src/commands/` and a loader in `index.js` that `require`s every other `.js` in the folder (skip `index.js`). Shared helpers (`needQueue`, `reply`) go to `src/commands/_util.js` (underscore files are skipped by the loader). No behaviour change. *Done when:* all 9 existing commands work, `deploy-commands.js` still sees them.
- [x] **0.2 - Error classification (S).** In `youtube.js`, map yt-dlp stderr to `{code, message}`: `BOT_CHECK` ("Sign in to confirm"), `AGE_RESTRICTED`, `UNAVAILABLE`/`PRIVATE`, `GEO_BLOCKED`, `LIVE_UNSUPPORTED`, `NETWORK`, `UNKNOWN`. Surface friendly text; for `BOT_CHECK` mention `YTDLP_COOKIES`. Unit-test the classifier with sample stderr strings. *Done when:* `/play` of a private video shows a clear embed, not raw stderr.
- [x] **0.3 - Stream options plumbing (M).** Change `stream(track)` to `stream(track, { seek = 0, filters = [], volume = 1 })`. Build the ffmpeg arg list in a pure function `buildFfmpegArgs(opts)` (tested). Seek: use `-ss` as an *input* option; for non-live tracks fetch a direct audio URL via `yt-dlp -g -f bestaudio` and feed it to ffmpeg `-i <url>` (so seeking is fast) instead of piping stdout; keep the stdout pipe path as fallback for seek=0 if `-g` fails. `GuildQueue.play(track, silent, opts)` stores `this.opts` (volume, filters) per guild. *Done when:* `buildFfmpegArgs` tests pass and playback is unchanged for defaults.
- [x] **0.4 - Persistent settings store (M).** `src/store.js`: JSON file `data/settings.json` (gitignored; add `data/` to `.gitignore`), API `get(guildId)`, `set(guildId, patch)`, debounced (1s) atomic writes, loads at startup, tolerant of corrupt file (back up as `.bad`, start empty). Defaults: `{ volume: 100, djRole: null, textChannel: null, twentyFourSeven: false, autoplay: false }`. Unit-test with a temp dir. *Done when:* values survive a restart.
- [x] **0.5 - Deploy files (S).** Add `ecosystem.config.js` (PM2, `max_memory_restart: '400M'`), `Dockerfile` (node:22-alpine, install `ffmpeg` is NOT needed since ffmpeg-static; alpine needs `gcompat` for yt-dlp_linux or use the `yt-dlp` python-free musl build - verify), `.dockerignore`, and a GitHub Actions workflow running `npm ci && npm run check && npm test`. Update README deploy section. *Done when:* CI is green on a push.

---

## Phase 1 - Core playback features

- [x] **1.1 - `/volume` (S, needs 0.3, 0.4).** Option 1-200. Stored in settings; applied via ffmpeg `-af volume=<v/100>`. Changing volume mid-track restarts the current track at the current position (`seek = playbackDuration`) - acceptable brief gap; tell the user. Cap 200 (+ `alimiter` filter to avoid clipping).
- [x] **1.2 - `/seek <time>` and `/restart` (S, needs 0.3).** Parse `90`, `1:30`, `1:02:03`, `+30`, `-15` (pure parser, tested). Elapsed time = `player.state.resource.playbackDuration` + the seek offset the stream was started with (track it as `this.offset`). Reject for live streams.
- [x] **1.3 - Queue management (M).** `/remove <pos>`, `/move <from> <to>`, `/shuffle`, `/clear`, `/skipto <pos>`, `/jump`-style `/playnext <query>` (insert at queue front, vs `/play` appending). Implement as pure `GuildQueue` methods with unit tests (they do not need Discord). Bound-check all indices.
- [x] **1.4 - Progress bar + live now-playing (M).** `/nowplaying` shows `▬▬▬🔘▬▬▬ 1:23 / 3:45` computed from elapsed time (pure `progressBar(elapsed, total, width)` function, tested). The announce embed on each new track also shows it (static at start).
- [x] **1.5 - Control buttons (M).** Attach an action row to the Now Playing announce message: Pause/Resume toggle, Skip, Stop, Loop-cycle, Queue. Route `Events.InteractionCreate` button interactions via customId prefix `np:<action>`; verify clicker is in the bot's voice channel; update the button states/labels on the message. Disable buttons when the track ends (edit the previous message). Keep a reference to the last announce message on `GuildQueue` to avoid leaks.
- [x] **1.6 - `/search` with picker (M).** `ytsearch5:`, show a `StringSelectMenu` (ephemeral), user picks one or several; 60s timeout then disable. Add `resolveMany(query, n)` to the source interface.
- [x] **1.7 - `/play` autocomplete (M).** Use YouTube's keyless suggest endpoint (`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&q=<q>`) - fast enough for the 3s autocomplete limit, unlike yt-dlp. Cache results in a small LRU (max 200 entries, 5 min TTL), debounce nothing server-side (Discord already throttles), return max 25 choices (<=100 chars each). Fail silently to an empty list.
- [x] **1.8 - Prefetch next track (M).** While track N plays, when remaining time < 20s (or immediately for short tracks) resolve the direct audio URL for track N+1 (`yt-dlp -g`) and cache on the track object so the transition has no yt-dlp startup gap. Cancel/forget on queue changes. Measure: gap between tracks should drop to well under 1s.
- [x] **1.9 - Reliability (M).** (a) On stream error before any audio flows, retry once with an alternate format (`-f bestaudio/best` -> `-f ba*`), then skip with an embed. (b) Voice reconnect: on `Disconnected` try rejoin; if the bot is moved to another channel, follow it instead of destroying. (c) Handle `/play` when the bot is in another channel (reply "I'm in <channel>"). (d) Global `uncaughtException` log. (e) `process.on('SIGTERM')` graceful shutdown: destroy all queues, `client.destroy()`.

---

## Phase 2 - Sources

- [x] **2.1 - Source registry (S, needs 0.1).** Add `canHandle(query)` to sources; `player.resolve()` picks the first source that can handle a URL, falling back to YouTube search. Track gets `source` field.
- [x] **2.2 - SoundCloud, Bandcamp, Vimeo, direct audio URLs (S).** yt-dlp supports these natively: a generic `ytdlp-generic` source for any `http(s)` URL not matching other sources (check `--simulate` fails gracefully). Block `file://`, localhost and private IP ranges (SSRF guard - pure function, tested).
- [x] **2.3 - Spotify links (M).** For `open.spotify.com/track|album|playlist/...`: fetch public metadata keylessly (the `https://open.spotify.com/oembed?url=` endpoint gives title for tracks; for albums/playlists parse the embed page `https://open.spotify.com/embed/<type>/<id>` `__NEXT_DATA__` JSON for the track list). Convert each into `ytsearch1:"<artist> - <title>"`, resolve lazily (resolve the first immediately, the rest right before they play, to keep `/play` fast). Cap at 100 tracks. No Spotify API keys or audio is taken from Spotify.
- [x] **2.4 - Live streams (S).** Allow live YouTube streams (no duration, no seek) and internet radio URLs; label as "LIVE" in embeds. Make sure `fmt(0)` -> "Live" stays consistent.

---

## Phase 3 - Audio effects

- [x] **3.1 - `/filter` presets (M, needs 0.3).** Choices: `off`, `bassboost`, `nightcore` (`asetrate=48000*1.25,aresample=48000`), `vaporwave`, `8d` (`apulsator=hz=0.08`), `treble`, `karaoke` (`pan=stereo|c0=c0-c1|c1=c1-c0`), `loudnorm`. Define in `src/music/filters.js` as `{ name: ffmpegFilterString }`, combinable (multi-select via subcommands `add/remove/clear`), join with `,`. Applying restarts the current track at its position (same mechanism as volume). Tested: pure `buildFilterChain(names)`.
- [x] **3.2 - Auto loudness normalisation (S).** Optional per-guild setting adding `loudnorm=I=-16:TP=-1.5:LRA=11` (note: costs CPU; default off, document).
- [x] **3.3 - SponsorBlock (M).** Optional setting; fetch segments from `https://sponsor.ajay.app/api/skipSegments?videoID=<id>&categories=["sponsor","selfpromo","intro","outro"]`, cache per video, and schedule `seek` past segments using a timer driven by elapsed time (no re-encode of the file; use the 1.2 seek mechanism). Fail silently if the API is down.

---

## Phase 4 - Discovery & social

- [x] **4.1 - Autoplay / radio (M).** `/autoplay on|off`. When the queue empties, take the last track's video ID and resolve `https://www.youtube.com/watch?v=<id>&list=RD<id>` (YouTube Mix) via yt-dlp `--flat-playlist`, pick a not-recently-played entry (keep a per-guild history of the last 50 IDs). Announce with a "Autoplay" footer.
- [x] **4.2 - `/lyrics` (S).** Query `https://lrclib.net/api/get?artist_name=&track_name=&duration=` then `/api/search?q=` as fallback. Clean the YouTube title first (strip `(Official Video)`, `[Lyrics]`, `ft.`, ` - Topic` etc. - pure `cleanTitle()` function with many test cases). Paginate long lyrics across embeds with prev/next buttons (4096-char chunks). If synced lyrics exist, mention it but plain text is fine.
- [x] **4.3 - History + `/replay` (S).** Per-guild last 25 played tracks (in memory; persist optionally via store). `/history` list, `/replay <n>` re-queues.
- [x] **4.4 - Personal playlists (L, needs 0.4).** `data/playlists.json` keyed by user ID: `/playlist create|delete|list|show|add|remove|play|save-queue`. Limits: 25 playlists/user, 200 tracks/playlist, names <= 32 chars. Store only `{title,url,duration,author}`. Atomic writes via the same store helper (generalize `store.js` to named collections).
- [x] **4.5 - Favorites (S, needs 4.4).** "Heart" button on the Now Playing embed adds to a built-in `favorites` playlist; `/favorites play`.
- [x] **4.6 - Voting (S).** Vote-skip: when > 2 humans listen, `/skip` needs a majority (or the requester/DJ). Add `/forceskip` for DJs/admins.

---

## Phase 5 - Server administration

- [x] **5.1 - `/settings` (M, needs 0.4).** View/change: DJ role (restricts destructive commands: skip, stop, clear, remove, volume, filter, seek), music-command channel restriction, default volume, 24/7 mode, max queue length (default 500), max track duration (default 3h). Requires `ManageGuild`. Implement a single `canUse(member, commandName)` permission function (pure given inputs, tested).
- [x] **5.2 - 24/7 mode + queue persistence (M).** With `twentyFourSeven`, stay in the channel when idle. Persist `{voiceChannelId, textChannelId, current, tracks, loop, position}` per guild on change (debounced) and restore on startup after a restart/crash (join and resume from the position; skip entries that no longer resolve). Keep it small (<= 100 tracks persisted).
- [x] **5.3 - Rate limiting (S).** Per-user cooldown on `/play` and `/search` (e.g. 3s) and per-guild cap on concurrent yt-dlp spawns (global limit of 2 concurrent resolves) to protect the 512MB host. Small in-memory token bucket, tested.

---

## Phase 6 - Observability & polish

- [x] **6.1 - `/stats`, `/ping`, `/help` (S).** Stats: uptime, RSS and heap (`process.memoryUsage()`), guild count, active voice connections, yt-dlp version (cached `yt-dlp --version`), Node and library versions. `/help` auto-generated from the command list (`data.description`).
- [x] **6.2 - Structured logging (S).** Tiny `src/log.js` (levels via `LOG_LEVEL`, timestamps, no deps). Replace `console.*`. Log each play with guild id, source, resolve and first-byte latency.
- [x] **6.3 - Memory watchdog (S).** Every 60s check RSS; if above `MAX_RSS_MB` (default 420) log a warning, clear caches (autocomplete, prefetch, history) and call `global.gc` if exposed. Exit non-zero above 480 so PM2/host restarts it cleanly.
- [x] **6.4 - Presence (S).** Rotating presence text ("/play | N servers", current song title when exactly one guild is playing). Use a single 30s timer.
- [x] **6.5 - yt-dlp self-update hardening (S).** Update script: verify download size > 5MB and `--version` runs before swapping the binary; keep the previous binary as `.bak` and restore on failure. Trigger an immediate update + retry once when a `UNKNOWN`/extractor error occurs (rate-limit to once per hour).
- [ ] **6.6 - i18n-ready strings (M, optional).** Move user-facing strings to `src/strings/en.js`; embeds read from it. Only do if the user asks.

---

## Phase 7 - UX redesign + next features (planned 2026-11-15)

**Already done (do not redo):** `/search` shows 8 results with 4+4 number buttons (`src/music/search-view.js`, `src/commands/search.js`); a multi-track `/play` result (playlist/mix/album) shows a prompt - play all / shuffle / first only / play next / save / cancel (`src/commands/_collection-prompt.js`, `src/music/collection*.js`); `/queue` is paginated with first/prev/next/last (`src/music/queue-view.js`, shared helpers in `src/music/pager.js`); YouTube playlists load up to 200 tracks; saved playlists and favorites load without resolving each track (`loadSavedTracks`). **Reuse `pager.js` + the collector pattern in `queue-view.js` for every paginated view below.**

Conventions for Phase 7: Discord components use customId prefixes (`queue:`, `search:`, `collection:`, `np:`), each owned by ONE collector or by the `np:` router in `src/index.js`; every collect handler must `deferUpdate()`/reply within 3s, be wrapped in try/catch, and check the clicker (only the requester for prompts). Pure builders (embed + rows) go in `src/music/*-view.js` with tests in `tests/views.test.js`.


**Status (2026-11-15): Phase 7 is implemented except the optional items.**
- Done: 7.1-7.19 and 7D (7.22-7.26). 7.16 omits only the vague "history-aware shuffle-all" idea (`/dedupe`, `/jump` and the skip-duplicates setting are in).
- Not done on purpose: **7.20** (folder-based yt-dlp build: needs a binary download, ask first), **7.21** (speculative preload: would spend yt-dlp launches on guesses; the resolve cache in 7.19 already makes repeat plays instant), **6.6** (i18n, only if requested).
- New slash commands to register with `npm run deploy`: previous, speed, pitch, eq, sleep, dedupe, jump, radio, top, setup-player, admin; new options on lyrics (`live`) and settings (now-playing, fade, skip-duplicates, voice-status).
- Verified without Discord: unit tests, simulated interactions (see tests/*.test.js) and a real yt-dlp/ffmpeg smoke test of the audio paths. Not verified: real Discord voice and button behaviour.

### 7A - Finish the paginated/interactive UX
- [x] **7.1 - Paginate `/playlist show`, `/history`, `/lyrics`-style lists (S).** `/playlist show` currently truncates at 20, `/history` at 25. Build `buildListEmbed({title, items, page, perPage, formatItem})` on top of `pager.js`, reuse the queue nav row (`prefix` parameter so customIds do not clash), ephemeral for personal lists.
- [x] **7.2 - Queue actions from the queue view (M).** Add a second button row to `/queue`: Shuffle, Clear, Loop cycle, Autoplay toggle (DJ-restricted via `canUse`), plus a `StringSelectMenu` of the 10 tracks on the current page: choosing one opens Remove / Play now / Move to top. All actions call existing `GuildQueue` methods (`remove`, `move`, `skipTo`, `playNext`).
- [x] **7.3 - Autocomplete for queue positions (S).** `/remove`, `/move`, `/skipto`, `/seek`-style position options get `setAutocomplete(true)` returning `N. title` for the first 25 matching queued tracks (filter by typed text/number).
- [x] **7.4 - Live Now Playing (M).** Optionally refresh the progress bar of the latest now-playing message every 15s (single timer per guild, stops on pause/skip/stop/destroy, skip while nobody listens). Must respect Discord rate limits (<= 1 edit / 15s / guild) and the memory budget.
- [x] **7.5 - Search upgrades (S).** `/search source:youtube|soundcloud` (`scsearch8:` via the generic source), `page` buttons for results 9-16, and a "Queue all" button on the card.
- [x] **7.6 - Playlist prompt upgrades (S).** Add "Shuffle & play next", "Remove duplicates already in the queue" toggle, and a track-range option ("first N") via a modal (`ModalBuilder`, N 1-200).

### 7B - New features
- [x] **7.7 - `/previous` + `/back` (S).** Use `GuildQueue.history` (last 25) to replay the previous track; Previous button on the Now Playing row.
- [x] **7.8 - Speed and pitch (M).** `/speed 0.5-2` via `atempo` (chain filters for values outside 0.5-2), `/pitch -12..+12` semitones via `asetrate=48000*2^(n/12),aresample=48000,atempo=1/2^(n/12)`; integrate with the existing filter chain builder (`src/music/filters.js`) and restart-at-position mechanism.
- [x] **7.9 - 10-band `/eq` + presets (M).** Presets (flat, rock, pop, bass, vocal, classical) as `equalizer=` chains; custom bands as `/eq band:<hz> gain:<db>`. Persist per guild in settings; tested pure `buildEqChain()`.
- [x] **7.10 - Sleep timer (S).** `/sleep <minutes|off>`: after the current track (or N minutes) stop and leave. One timer per guild, cleared on destroy; shows remaining time in `/nowplaying`.
- [x] **7.11 - Radio stations (M).** `/radio` with a small curated list (lofi, jazz, synthwave... as YouTube live search queries or stream URLs in `src/music/stations.js`), select menu to pick, live label, auto-reconnect when the stream ends.
- [x] **7.12 - Synced lyrics (M).** `/lyrics live:true`: use LRCLIB `syncedLyrics`, edit one embed every ~5s showing the previous/current/next line based on `getElapsedSeconds()`; stop on track change. Cap to one live lyrics message per guild.
- [x] **7.13 - Voice channel status (S).** Set the voice channel status to the current track title via REST `PUT /channels/{id}/voice-status` (needs the "Set Voice Channel Status" permission; fail silently, clear on stop/leave, setting `voiceStatus` default off).
- [x] **7.14 - Per-server stats and `/top` (M).** Count plays per track and listening minutes per guild in a small JSON store (bounded: keep the top 500 tracks, atomic writes); `/top tracks|users` paginated.
- [x] **7.15 - Request/jukebox channel (L).** `/setup-player` creates (or binds) a text channel with one persistent controller message (now playing + buttons + queue summary); typing is NOT used (no message-content intent), so requests go through a modal button "Add song" (`ModalBuilder` text input -> `music.resolve`). Re-attach the controller message after restart (store channel + message id in settings).
- [x] **7.16 - Smart queue helpers (S).** `/dedupe` (remove duplicate videos), `/skipdupes` setting, `/jump <text>` (find first queued title containing text), `/shuffle-all` that also reshuffles history-aware autoplay.
- [x] **7.17 - Crossfade-lite / fades (M, optional).** Optional `fade` setting adding `afade=t=in:d=1,afade=t=out:st=<dur-2>:d=2` when a re-encode is already happening; skip when audio is copied (document that fades disable the Opus copy fast path).
- [x] **7.18 - Cookies helper (S).** `/admin cookies-status` (owner only via `BOT_OWNER_ID`): shows whether `YTDLP_COOKIES` exists/was modified, last bot-check error time, and a hint when the host is likely blocked.

### 7D - Now Playing card redesign (PRIORITY: do right after 7.6, BEFORE 7.7/7.8, because later tasks add buttons to it)
Reported by the user from a real screenshot. Problems with the current card (`embeds.nowPlaying` + `embeds.nowPlayingControls`):
1. **Bug:** the progress line reads `Live / 3:57` for a normal track. `embeds.fmt(0)` returns `'Live'`, and elapsed is `0` when the card is first sent. Elapsed time must never be formatted with the "Live" rule.
2. The progress bar is static (never moves) and uses a 🔘 emoji line that renders inconsistently.
3. `Duration` is shown twice (bar and field); `Channel`/`Requested by` fields are low value; titles carry noise like hashtags and "(Official Video)".
4. Buttons: 6 plain text buttons in 2 uneven rows, mostly the same blue, long labels (`Loop: off`), no icons, no visual state (loop on/off, paused).
5. No context: nothing about what plays next, queue size/remaining time, volume, active filters, autoplay.

- [x] **7.22 - One source of truth for the card (M).** Create `src/music/nowplaying-view.js` exporting a pure `buildNowPlayingCard(snapshot)` -> `{ embed, rows }`, where `snapshot = { track, elapsed, paused, live, loop, autoplay, volume, filters, next, queuedCount, remainingSeconds, requestedBy }` built by one `GuildQueue.getNowPlayingSnapshot()` method. Use it everywhere a now-playing card is shown: the announce message, `/nowplaying`, the "Now playing" reply of `/play`, `/search`, the playlist prompt and `/playnext` (those replies pass `withControls:false`), and the live progress updater from 7.4. Remove the duplicated builders in `embeds.js` once everything uses it (keep `embeds.nowPlaying` as a thin wrapper if other code still imports it). Add a separate `formatClock(seconds)` (never returns "Live"; `m:ss` / `h:mm:ss`) and keep `fmt` only for durations where 0 means live. *Done when:* a regression test proves elapsed 0 renders `0:00`, never `Live`.
- [x] **7.23 - New card layout (M).** Target layout (keep it compact, readable on mobile, no more than 2 button rows):
  ```
  ▶ Now playing                                    [thumbnail]
  **Make Me Strong**                                (clean title, linked)
  Sami Yusuf · requested by Sid
  1:23 ▰▰▰▰▱▱▱▱▱▱▱▱▱▱ 3:57                          (live: 🔴 LIVE, no bar)
  🔁 Loop: queue  ·  🔊 80%  ·  🎚 Bass boost  ·  📻 Autoplay     (only the ones that are active)
  **Up next:** Song title (3:12)  ·  12 more · 48m left
  ```
  Rules: header shows state (`▶ Now playing`, `⏸ Paused`, `🔴 Live`, `📻 Autoplay`); use block characters `▰▱` (not the 🔘 emoji) with a fixed width of 14; show the duration once (in the bar line); embed colour by state (playing blurple, paused yellow, live red, autoplay teal); display title is cleaned for display only (strip hashtags, `(Official ...)`, `[Lyrics]`, ` - Topic`; reuse/extend the pure `cleanTitle` from `src/music/lyrics.js` into `src/music/title.js` and never change `track.title` itself); thumbnail as the embed thumbnail; the "Up next" line is omitted when the queue is empty. Every text field is clipped to Discord limits.
- [x] **7.24 - New controls (M).** Replace the button rows with:
  Row 1 (icon + no long labels): `⏮` Previous (enabled once 7.7 exists, otherwise omit), `⏯` Pause/Resume (Primary, icon flips ⏸/▶), `⏭` Skip, `⏹` Stop (Danger), `🔁` Loop (Secondary when off, Success when track/queue, icon `🔂` for track loop).
  Row 2: `🔀` Shuffle, `📜` Queue, `♥` Favorite, `🎤` Lyrics (opens the existing `/lyrics` flow ephemerally), `🔉`/`🔊` volume -10/+10 (only if there is room; 5 per row max, otherwise move volume to a third small row).
  All still routed through the `np:` router in `src/index.js` with the same permission rules as the matching slash commands (`canUse`, same voice channel, vote-skip). After any state change (pause, loop, volume, filter, shuffle) re-render the WHOLE card from the snapshot (embed + rows), not only the components. Disable all buttons when the track ends.
- [x] **7.25 - Card lifecycle and tidiness (S).** When a track ends, edit its card into a compact one-line "Finished: <clean title>" (no buttons, no thumbnail) instead of leaving a live-looking card; keep only the latest card per guild with controls. Setting `cleanupNowPlaying: 'edit' | 'delete' | 'keep'` (default `edit`) in `/settings`. Never edit a message that was deleted (ignore Unknown Message errors and stop timers).
- [x] **7.26 - Card tests and simulation (S).** Pure tests for `buildNowPlayingCard`: every state (playing, paused, live, autoplay, loop modes, with/without next, filters, long/emoji titles, missing thumbnail/author), Discord limits (title 256, description 4096, field values 1024, <=5 buttons/row, <=5 rows), the `formatClock` regression, and button disabled/style states. Plus a simulation test driving the real `np:` router with fake interactions: pause toggles icon + colour, loop cycles and changes style, skip by a non-listener is rejected, stop respects the DJ role, and the card re-renders from the live queue.

Manual Discord checklist for 7D: play a track and confirm the elapsed time starts at `0:00` (never "Live"); press Pause (icon flips, colour turns yellow), Loop (button turns green), Skip, and Favorite; play a live stream (red LIVE card, no bar); play a playlist and check "Up next" and "N more"; let a track finish and check the old card collapses to "Finished: ...".

### 7C - Speed (continue the latency work)
- [x] **7.19 - Resolve cache (S).** LRU (max 200, 30 min TTL) keyed by normalized query -> resolved single track including its direct audio URL; invalidate when the URL is within 2 min of `expire`. Wire into `youtube.resolve` and the autocomplete choice so picking a suggestion is instant the second time.
- [ ] **7.20 - Warm yt-dlp (M, optional).** Windows launches `yt-dlp.exe` in ~1.3s each time. Measure and, if worthwhile, support the folder-based Windows build (`yt-dlp_win.zip`, no self-extraction) in `scripts/update-ytdlp.js` (validate with `--version`, keep `.bak`), or an optional long-lived Python helper when `python` exists. Keep the current single-file path as the fallback.
- [ ] **7.21 - Speculative preload on autocomplete (S, optional).** When a user picks an autocomplete suggestion the value equals the suggestion text; pre-resolve the top suggestion in the background for 1 concurrent request per guild (respect `limitResolve`).

---

## Explicit non-goals
Web dashboard, database servers, Lavalink, message-prefix commands, downloading/saving audio files, any feature needing paid APIs or the message-content intent, anything that pushes idle RAM over the budget.

## Manual test checklist template (agent: copy into your final message per task)
1. `npm run deploy` (if commands changed), `npm start`.
2. In a voice channel run: <commands>.
3. Expected: <what appears in chat / what is audible>.
4. Edge: <empty queue, user not in voice, bot in other channel, live stream, very long playlist>.
5. Watch the terminal for errors and check Task Manager RSS stays < 200MB while playing.

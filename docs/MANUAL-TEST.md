# Manual test checklist (real Discord)

Automated tests cover the logic and simulated clicks. **Only a real Discord session proves the buttons, modals,
voice and permissions.** Work through this once after `npm run deploy` and a restart. Tick as you go.

Before you start: join a voice channel; have a second person (or alt account) for the "other user" checks.
Run `npm run selftest` first; it must end with `0 error(s)`.

## 1. Basics
- [ ] `/play adele hello` → joins, you **hear** it, the reply is the Now Playing card (elapsed starts at `0:00`, never "Live").
- [ ] Card shows: slider bar, Duration / Channel / Requested by, Up next (after queueing more), Settings line only when something is active.
- [ ] `/play` the same song again → starts almost instantly (cache).
- [ ] `/play` with a **YouTube link**, a **SoundCloud link**, a **Spotify track link**.
- [ ] Autocomplete appears while typing in `/play`.

## 2. Card buttons
- [ ] ⏸ Pause / ▶ Resume (button turns green, header says Paused, colour turns yellow).
- [ ] ⏭ Skip (with 3+ listeners a vote is needed; the requester can skip alone).
- [ ] ⏮ Prev (disabled on the first song), 🔁 Loop cycles `off → queue → track` and changes colour.
- [ ] 🔀 Shuffle, 📜 Queue (opens the paged queue), ❤ Favorite, 🎤 Lyrics, 🔉 / 🔊 volume ±10 %.
- [ ] ⏹ Stop clears everything; the card collapses to "Finished: …".
- [ ] A second user's buttons are rejected when they are not in the voice channel.

## 3. Playlists and search
- [ ] `/play` a **YouTube playlist link** → prompt with title, track count, total time, first 6 songs.
- [ ] Try: Play all, Shuffle, Skip duplicates (toggle), Save, and the drop-down: First song only, **First N…** (modal), Play next, Shuffle & play next.
- [ ] Another user pressing the prompt buttons is rejected; after 60 s the buttons turn off.
- [ ] `/search` shows 8 results; press a number; try page 2, **Queue all**, Cancel; try `source: SoundCloud`.
- [ ] `/playlist show`, `/playlist play <name>`, `/favorites` use the same prompt where there are several songs.

## 4. Queue
- [ ] `/queue` pages (First/Prev/Next/Last), select a track → Remove / Play now / Move to top, Shuffle, Clear.
- [ ] `/remove`, `/move`, `/skipto`, `/jump` (autocomplete shows queued titles), `/dedupe`, `/replay`, `/history`.
- [ ] **`/undo`** after remove / clear / shuffle / move / adding songs restores the queue; after `/stop` there is nothing to undo.
- [ ] **Right-click a message with a link (or a song name) → Apps → Play this** plays it. On a message with nothing playable it answers privately.

## 5. Sound
- [ ] Loudness is **even** between a loud and a quiet song, and quieter than before; Discord's user volume for the bot at 100 %.
- [ ] `/normalize enabled:true level:normal` is louder; `enabled:false` brings back the original uneven volume.
- [ ] `/speed 1.25`, `/pitch +3`, `/eq preset:bass`, `/filter add bassboost`: the song restarts at the same position; progress bar still correct.
- [ ] `/volume 50` then `/volume 100`.
- [ ] Let a whole **4+ minute song play to the very end**: it must not stop early.

## 6. Radio, lyrics, extras
- [ ] `/radio` → pick a station; it plays and is leveled; stopping works; `/skip` leaves the station.
- [ ] `/lyrics` shows paged lyrics; `/lyrics live:true` follows the song (updates about every 5 s).
- [ ] `/sleep in 1` stops and leaves after a minute; `/sleep track`; `/sleep off`.
- [ ] `/top tracks`, `/top users` after a few plays.

## 7. Server setup
- [ ] `/settings` view / DJ role (restricted buttons and commands now need the role) / channel / 24-7 / fade / skip-duplicates / voice-status / now-playing cleanup.
- [ ] `/setup-player create` posts the player message; **Add song** opens a modal; songs requested there do not spam the channel; the message returns to "Nothing is playing" when idle.
- [ ] Restart the bot: the player message is re-attached; with 24/7 on, the queue comes back.

## 8. Owner tools (set `BOT_OWNER_ID` first)
- [ ] `/admin selftest` → all green (Discord ping, yt-dlp, ffmpeg, network, a YouTube lookup).
- [ ] `/admin cookies`, `/admin logs lines:20`.
- [ ] `/stats` shows `Helpers: ffmpeg … yt-dlp …` and `Total ≈ … of 512 MB`.

## 9. Problems on purpose
- [ ] Server-mute the bot → it posts a "server-muted" warning once.
- [ ] Remove the bot's Speak permission in a voice channel and `/play` → it says which permission is missing.
- [ ] Play a private/deleted video link → friendly error, queue continues.
- [ ] Kill the network for a few seconds mid-song (or just wait through a long song): the song continues or resumes.
- [ ] `/help` shows commands plus "Right-click a message → Apps: **Play this**".

If something fails: `/admin logs`, then `npm run selftest`, and note the exact steps.

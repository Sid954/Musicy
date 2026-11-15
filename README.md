# 🎵 Musicy

**A lightweight, self-hosted Discord music bot that fits on a free 512 MB host.**
Play songs and playlists from YouTube (and more) in your voice channel, with a clean Now Playing card, even
loudness between songs, a paged queue, effects, lyrics and radio. No database, no paid API keys.

[![CI](https://github.com/Sid954/Musicy/actions/workflows/ci.yml/badge.svg)](https://github.com/Sid954/Musicy/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Node.js 18+](https://img.shields.io/badge/node-%E2%89%A518-brightgreen)

> Musicy is a hobby project built for **small, private servers**. Please read the
> [Legal and fair use](#legal-and-fair-use) section before you run it.

## What it looks like

```
▶ Now playing
Ravyn Lenae - Love Me Not                                  [cover art]
▬▬▬▬🔘▬▬▬▬▬▬▬▬▬ 1:12 / 3:34

Duration: 3:34     Channel: R&BHype     Requested by: Sid
Up next
  Impostor Syndrome · 4:55
  182 more · 11h 44m left

[⏮ Prev] [⏸ Pause] [⏭ Skip] [⏹ Stop] [🔁 Loop: off]
[🔀 Shuffle] [📜 Queue] [❤ Favorite] [🎤 Lyrics]
[🔉 -10%] [🔊 +10%]
```

## Features

**Playing music**
- `/play` a song name or a link (YouTube, SoundCloud, Spotify track/album/playlist links, direct audio files).
  Autocomplete suggests as you type.
- **Playlist links ask what you want:** play all, shuffle, first song only, first N songs, play next,
  skip duplicates, or save it as your own playlist.
- `/search` shows 8 results with number buttons (YouTube or SoundCloud, two pages, "Queue all").
- **Right-click any message → Apps → Play this** plays the link, audio file or song name in it.
- 16 built-in live radio stations (`/radio`).

**Sound**
- **Automatic loudness leveling (on by default):** every song is brought to the same loudness, so you never turn the
  volume up and down between tracks. In a test on six real songs the gap between the loudest and quietest shrank from
  14.7 LU to about 2 LU. Three levels: soft (default), normal, loud (`/normalize`).
- Speed, pitch, 10-band equalizer with presets, filters (bass boost, nightcore, 8D, karaoke, …), volume, fades.

**Queue and control**
- A **Now Playing card** with buttons: previous, pause, skip, stop, loop, shuffle, queue, favorite, lyrics, volume.
- A **paged queue** (`/queue`) where you can pick a track and remove it, play it now, or move it to the top.
- `/undo` takes back the last queue change. `/jump`, `/skipto`, `/move`, `/remove`, `/dedupe`, `/history`, `/replay`.
- Vote-skip, optional **DJ role**, loop (track/queue), autoplay (similar songs), sleep timer, 24/7 mode.
- **Request channel:** `/setup-player` posts one pinned player message with an **Add song** button.

**Extras**
- Synced lyrics that follow the song (`/lyrics live:true`), plain lyrics, SponsorBlock skipping.
- Personal playlists and favorites, listening stats (`/top`), optional voice-channel status showing the song.

**Built to be dependable**
- Songs that YouTube cuts off mid-download are resumed automatically.
- Startup checks, a self-test (`npm run selftest` / `/admin selftest`), a rotated log file, and optional **DM alerts
  to the owner** when the same error keeps happening.
- Clear messages instead of silence: missing Connect/Speak permission, full channel, server-muted bot.

All commands: [`docs/COMMANDS.md`](docs/COMMANDS.md).

## Quick start

You need **Node.js 18 or newer** (22 recommended) and a Discord account.

1. **Create the bot.** Open the [Discord Developer Portal](https://discord.com/developers/applications) → *New
   Application* → *Bot* → copy the **token**. Also copy the **Application ID** (General Information).
   Musicy needs **no privileged intents**, so leave those switches off.
2. **Invite it.** Open this link (replace `YOUR_CLIENT_ID` with the Application ID):
   ```
   https://discord.com/oauth2/authorize?client_id=YOUR_CLIENT_ID&scope=bot%20applications.commands&permissions=3165184
   ```
   It asks for: View Channels, Send Messages, Embed Links, Connect, Speak. (Optional, for the voice-channel status
   feature: *Set Voice Channel Status*.)
3. **Install and configure.**
   ```bash
   git clone https://github.com/Sid954/Musicy.git
   cd Musicy
   npm install
   cp .env.example .env      # on Windows: copy .env.example .env
   ```
   Open `.env` and fill in `DISCORD_TOKEN` and `CLIENT_ID`. Never share or commit this file.
4. **Register the commands and start.**
   ```bash
   npm run deploy      # registers the slash commands (again whenever commands change)
   npm run selftest    # optional: checks your setup without starting the bot
   npm start           # first start downloads yt-dlp automatically
   ```
   Tip: set `GUILD_ID` in `.env` while testing so commands appear in your server instantly.

Join a voice channel and try `/play adele hello`.

## Configuration

Everything is optional except the first two. See [`.env.example`](.env.example).

| Variable | Default | What it does |
|---|---|---|
| `DISCORD_TOKEN` | – | Your bot token (**required**) |
| `CLIENT_ID` | – | Application ID (needed for `npm run deploy`) |
| `GUILD_ID` | – | Register commands in one server instantly (testing) |
| `BOT_OWNER_ID` | – | Your Discord user ID: enables `/admin` and error alerts by DM |
| `MEMORY_LIMIT_MB` | 512 | Your host's RAM; `/stats` shows how close you are |
| `IDLE_LEAVE_MINUTES` | 3 | Leave an empty or idle voice channel after this long |
| `YTDLP_COOKIES` | – | Path to a cookies file (only if YouTube asks your host to sign in) |
| `LOG_LEVEL` / `LOG_FILE` / `LOG_MAX_MB` / `LOG_KEEP` | info / `data/logs/bot.log` / 2 / 3 | Logging; `LOG_FILE=off` disables the file |
| `YTDLP_JS_RUNTIME` | auto | `auto` retries a failed lookup once with a JavaScript runtime; `always`, `off` |

Per-server settings (DJ role, command channel, volume, 24/7, limits, loudness level, fades, …) are changed in
Discord with `/settings`, `/normalize` and friends, and saved in `data/`.

## How it works

```
 /play adele hello
        │
        ▼
 ┌──────────────┐   one yt-dlp call: song info + a direct audio URL   (cached for repeat plays)
 │  Musicy      │───────────────────────────────────────────────────▶ YouTube / SoundCloud
 │  (Node.js)   │
 └──────┬───────┘
        │ direct URL
        ▼
   ffmpeg  ──  loudness leveling + effects (EQ, speed, pitch, volume)  ──▶  Opus audio
        │      (reconnects if the connection drops; nothing is saved to disk)
        ▼
   @discordjs/voice  ──  end-to-end encrypted voice  ──▶  your voice channel
```

- **One queue per server** (`GuildQueue`) owns the voice connection, the track list, the player and the Now
  Playing card. Everything that changes the sound or the queue goes through it.
- **Audio never touches disk and is never decoded in JavaScript.** yt-dlp finds the audio, ffmpeg turns it into
  Opus, Discord receives it.
- **Pure logic is separated from Discord**, so most of it is unit-tested (294 tests) without a Discord connection.
- **Light on memory:** the bot itself idles around 80 MB; yt-dlp uses about 90 MB for a few seconds during a
  lookup; ffmpeg about 20 MB per server that is playing. `/stats` shows the real numbers on your host.

More detail for developers: [`CLAUDE.md`](CLAUDE.md) (architecture map), [`AGENTS.md`](AGENTS.md) (rules for
AI coding agents), [`docs/ROADMAP.md`](docs/ROADMAP.md) (what was built and what is planned).

## Hosting for free

Musicy is designed for a free 24/7 host with 512 MB RAM and 1 GB disk (for example Wispbyte). Step-by-step
instructions, the self-test, memory numbers and troubleshooting: [`docs/DEPLOY.md`](docs/DEPLOY.md).
A `Dockerfile` and a PM2 config are included (the Dockerfile has not been built yet, so treat it as untested).

## Data and privacy

- Musicy uses only two intents (Guilds, Guild Voice States) and **does not read your chat**. The only message text
  it ever sees is the one message you explicitly right-click with **Play this**.
- It saves, in the `data/` folder next to the bot: per-server settings, your playlists (song titles and links),
  listening statistics (song titles and the Discord IDs of whoever requested them), the 24/7 queue, and logs.
  Nothing is sent anywhere except to the services below when you use a feature.
- Services contacted: YouTube / SoundCloud (through yt-dlp), `lrclib.net` (lyrics), `sponsor.ajay.app`
  (SponsorBlock, only if enabled), YouTube's suggestion endpoint (autocomplete), Spotify's public embed pages
  (only to read the **names** of tracks in a Spotify link; the audio always comes from YouTube), and GitHub
  (to download yt-dlp updates).
- Your token and cookies stay on your machine. Logs and the self-test never print the token.

## Troubleshooting

| Problem | Try |
|---|---|
| Bot is in the channel but silent | Is it server-muted? Check the per-user volume for the bot in Discord. Run `npm run selftest`. |
| "Sign in to confirm you're not a bot" | YouTube is limiting your host. See `/admin cookies` and [`docs/DEPLOY.md`](docs/DEPLOY.md). |
| Slash commands are missing | Run `npm run deploy` again (with `GUILD_ID` set it is instant). |
| Won't start | The startup check prints exactly what is wrong. `npm run selftest` checks everything. |
| Something else | `/admin logs`, then open an issue (the template asks for the self-test output). |

## Legal and fair use

_This is plain-language information, not legal advice._

- **Musicy does not host, store or distribute any music or other copyrighted content.** It streams audio on demand
  from public sources to a voice channel and **saves no audio**.
- **Platform terms apply.** Tools that read audio from YouTube and similar services can conflict with those
  services' terms of service. Musicy is meant for **personal use on small private servers**. **You** are
  responsible for following the terms of every service you use, Discord's
  [Developer Policy](https://discord.com/developers/docs/policies-and-agreements/developer-policy), and the laws where you live.
  Running a large public bot is a different situation with different obligations (for example licensing).
- **No DRM circumvention.** Musicy has no features for removing DRM, bypassing paywalls or downloading and
  keeping files. Spotify links are used only to read public track names.
- **Third-party software is not included in this repository.** yt-dlp is downloaded from its official releases
  when the bot first starts; FFmpeg comes from the `ffmpeg-static` npm package when you run `npm install`
  (FFmpeg is LGPL/GPL software, see its license). Each has its own license.
- **Cookies are optional** and only for hosts that YouTube limits. Using an account's cookies can put that account
  at risk; use them at your own risk and never share them.
- **Not affiliated** with Discord, YouTube/Google, Spotify, SoundCloud, SomaFM or Radio Paradise.
- The software is provided **"as is"**, without warranty (see [`LICENSE`](LICENSE)).
- If you are a rights holder and have a concern about this project, please open an issue and I will respond.

## Contributing

Bug reports, ideas and pull requests are welcome. See [`CONTRIBUTING.md`](CONTRIBUTING.md). Before opening a bug,
run `npm run selftest` and include its output (never your token). The checklist for testing in real Discord is
[`docs/MANUAL-TEST.md`](docs/MANUAL-TEST.md).

## Credits

Built with [discord.js](https://discord.js.org/), [@discordjs/voice](https://github.com/discordjs/discord.js),
[yt-dlp](https://github.com/yt-dlp/yt-dlp) and [FFmpeg](https://ffmpeg.org/). Lyrics from
[LRCLIB](https://lrclib.net/), skip segments from [SponsorBlock](https://sponsor.ajay.app/), radio from
[SomaFM](https://somafm.com/) (listener supported, please consider donating) and
[Radio Paradise](https://radioparadise.com/).

## License

[MIT](LICENSE)

# Command reference

_Generated from the bot's own command definitions, so it always matches what Discord shows._

An option followed by `?` is optional. Most commands that change playback or the queue can be limited to a **DJ role** with `/settings dj-role`.

| Command | What it does |
|---|---|
| `/admin` subcommands: `cookies`, `selftest`, `logs` | Bot owner tools (only the BOT_OWNER_ID user can use them) |
| `/autoplay` `enabled` | Toggle YouTube Mix autoplay when the queue empties |
| `/clear` | Clear upcoming tracks from the queue |
| `/dedupe` | Remove duplicate songs from the queue |
| `/eq` subcommands: `preset`, `band`, `show`, `reset` | 10-band equalizer |
| `/favorites` | Play your saved favorite tracks |
| `/filter` subcommands: `add`, `remove`, `clear` | Manage audio filter presets |
| `/forceskip` | Skip the current track without a vote |
| `/help` | List music bot commands |
| `/history` | Show the last 25 played tracks |
| `/jump` `text` | Jump to the first queued song whose title contains some text |
| `/leave` | Leave the voice channel |
| `/loop` `mode` | Set loop mode |
| `/lyrics` `title`? `live`? | Find lyrics for the current track or a title |
| `/move` `from` `to` | Move a queued track |
| `/normalize` `enabled` `level`? | Even out loudness so every song plays at the same volume (on by default) |
| `/nowplaying` | Show the current track |
| `/pause` | Pause playback |
| `/ping` | Show Discord API latency |
| `/pitch` `semitones` | Shift pitch in semitones without changing speed (0 = normal) |
| `/play` `query` | Play a song or playlist from YouTube |
| **Play this** (right-click a message → Apps) | Plays the link, audio file or song name in that message. |
| `/playlist` subcommands: `create`, `delete`, `list`, `show`, `add`, `remove`, `play`, `save-queue` | Manage your personal playlists |
| `/playnext` `query` | Play a song or playlist next |
| `/previous` | Go back to the previous track |
| `/queue` | Browse the whole queue, page by page |
| `/radio` | Listen to a live radio station |
| `/remove` `position` | Remove a queued track |
| `/replay` `position` | Replay a track from recent history |
| `/restart` | Restart the current track |
| `/resume` | Resume playback |
| `/search` `query` `source`? | Search YouTube or SoundCloud and pick a result |
| `/seek` `time` | Seek within the current track |
| `/settings` subcommands: `view`, `dj-role`, `channel`, `volume`, `24-7`, `max-queue`, `now-playing`, `fade`, `skip-duplicates`, `voice-status`, `max-duration` | View or change server music settings |
| `/setup-player` subcommands: `create`, `remove` | Create a request channel player: one message with buttons to add songs |
| `/shuffle` | Shuffle the queued tracks |
| `/skip` | Vote to skip the current track |
| `/skipto` `position` | Skip to a queued track |
| `/sleep` subcommands: `in`, `track`, `off`, `status` | Stop and leave automatically after a while |
| `/speed` `factor` | Change playback speed without changing pitch (1 = normal) |
| `/sponsorblock` `enabled` | Toggle automatic SponsorBlock skipping |
| `/stats` | Show bot runtime and memory stats |
| `/stop` | Stop playback and clear the queue |
| `/top` subcommands: `tracks`, `users` | Listening statistics for this server |
| `/undo` | Undo the last change to the queue (remove, clear, shuffle, move, add, ...) |
| `/volume` `level` | Set playback volume |

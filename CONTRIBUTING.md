# Contributing to Musicy

Thanks for helping! Musicy is a small, friendly hobby project. Bug reports, ideas and pull requests are welcome.

## Quick start
```bash
git clone https://github.com/Sid954/Musicy.git
cd Musicy
npm install
npm run check      # syntax check of every file
npm test           # unit + simulated-interaction tests (no Discord or internet needed)
npm run selftest   # optional: needs a .env with your own bot token; checks helpers + network
```

## Ground rules
- **Keep it light.** The target is a free host with 512 MB RAM / 1 GB disk. Avoid heavy dependencies and anything
  that needs a compiler. Audio is never decoded in JavaScript or written to disk.
- **Test what you change.** Put pure logic in small functions and cover it in `tests/`. Components, modals and
  voice are checked with simulated interactions; real Discord is covered by [`docs/MANUAL-TEST.md`](docs/MANUAL-TEST.md).
- **Be honest in docs and messages.** Say what a feature does and what it costs.
- **Never commit secrets** (`.env`, tokens, `cookies.txt`, `data/`). They are in `.gitignore` for a reason.
- **Respect the platforms.** Please do not add features that remove DRM, bypass paywalls or ship third-party
  binaries in this repository. Musicy only streams public audio on demand.

## Where things are
Architecture notes live in [`CLAUDE.md`](CLAUDE.md) (written for AI coding agents, but a good map for humans too),
workflow rules for agents in [`AGENTS.md`](AGENTS.md), and the plan in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Pull requests
Small and focused is best. Describe what changed and how you tested it. `npm run check` and `npm test` must pass
(CI runs both).

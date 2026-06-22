# 🏈 Loyal Order of Water Buffaloes — Draft Board

A rookie-draft board for one MyFantasyLeague league (**Loyal Order of Water
Buffaloes**, league `21931`, 2026). It runs entirely in the browser — no backend —
so it lives happily on **GitHub Pages**, with state in `localStorage`.

**Live:** https://codyb11989.github.io/dynasty-draft-board/

![client side](https://img.shields.io/badge/runs-100%25%20client--side-4ade80) ![storage](https://img.shields.io/badge/data-localStorage-3b82f6)

## What it does

- **Pre-loaded with the league** — all 10 teams, the draft order, and the trades
  that already exist are baked in. Open it and start.
- **On-the-clock entry** — shows the current pick + team; type the player, hit
  Enter, it advances. Picks autocomplete from the **2026 rookie class** (with
  position + NFL team auto-filled); anyone missing? Just type the name.
- **Clean board** — one row per team, all 7 rounds, sticky headers, position
  color-coding (incl. IDP), and traded picks badged with their new owner.
- **Full-screen mode** — one click blows the board up to fill the screen for
  watching/projecting (button in the header or board toolbar; `Esc` exits).
- **Multi-tab sync** — open the board in several tabs/windows on the same device
  (e.g. a laptop + a projector) and they update together via the `storage` event.
- All updates are made under **⚙ Update / Settings** — the main page is just the board.

## Keeping it up to date (CORS-friendly, no auto-fetch)

Browsers can't call MFL directly (CORS), so updates are a quick copy-paste.
Open **⚙ Update / Settings → ① Update from MyFantasyLeague**. For each item there's
an **Open ↗** button (opens the raw JSON in a new tab) and a **Copy URL** button:

1. **Teams** — `TYPE=league` → team names.
2. **Draft order, trades & picks** — `TYPE=draftResults` → the draft order, every
   traded pick, **and which players have been drafted** (IDs are matched to the
   rookie pool, so the board fills in real names/positions/teams).
3. **Rookie pool** — `TYPE=players&DETAILS=1` → refreshes the rookie autocomplete.

Open → select-all → copy → paste into the one box → **Load**. The box auto-detects
which of the three you pasted. During the draft, re-pasting **draftResults** is the
one-step way to bring the whole board current.

## Updating the rookie list (`rookies-2026.json`)

Bundled and pulled from MFL. To refresh it (e.g. post-NFL-draft team changes):
**⚙ → ① → Rookie pool → Open**, copy, paste, Load — or regenerate the file from a
`TYPE=players&DETAILS=1` export and commit it.

## Run locally

Static files — serve the folder (the rookie list uses `fetch`, which
needs a server, not `file://`):

```bash
python -m http.server 8000   # then open http://localhost:8000
```

## Deploy

Already wired: pushing to `main` triggers `.github/workflows/deploy.yml`, which
publishes to GitHub Pages. (Pages must be enabled once: **Settings → Pages →
Source → GitHub Actions**.)

## Data & privacy

Everything is in `localStorage` (key `ddb.state.v2`) on each device. **⚙ → ③ Backup**
exports/imports the board JSON or resets to league defaults.

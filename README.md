# 🏈 Dynasty Draft Board

A live fantasy-football draft board that pulls your league's teams from
**MyFantasyLeague**, then lets a single user run the draft — entering picks and
draft-day trades — right in the browser. Everything is saved to your browser's
`localStorage`, so it works on **GitHub Pages** with no backend and no database.

![board](https://img.shields.io/badge/runs-100%25%20client--side-4ade80) ![storage](https://img.shields.io/badge/data-localStorage-3b82f6)

## Features

- **Pull your league from MyFantasyLeague** — enter your season + league ID and
  it grabs every team name, the full draft order, the number of rounds, and any
  picks already traded (`TYPE=league` + `TYPE=draftResults`). Snake vs. linear is
  auto-detected.
- **Clean board** — one row per team, all 7 rounds across the top (configurable).
  Sticky team column + round headers so big leagues scroll smoothly.
- **On-the-clock entry** — a fast input bar shows the current pick and team;
  type the player, hit Enter, and it advances to the next pick automatically.
- **Draft-day trades** — reassign any pick to a new owner. The board keeps the
  original team's row and badges the pick with its new owner, so traded picks
  are obvious at a glance.
- **Snake or linear** drafts, position color-coding, and a clean **print** view.
- **Multiple boards** — keep a separate board per league/season.
- **Export / import** a board as JSON for backup or sharing.

## A note on CORS (important)

Browsers block direct calls from your site to the MFL API (MFL only allows its
own domain). This app handles it two ways:

1. **Paste data manually (always works):** click **Paste data manually**. It
   shows two links — **(1) Teams** and **(2) Draft order & trades**. Open each,
   copy the JSON, and paste it into the box (it auto-detects which is which). Do
   teams first, then the draft. No third party involved — data stays in your browser.
2. **Auto-fetch (best effort):** the app will try a public CORS proxy. These are
   frequently rate-limited, so if it fails, just use the manual paste. You can
   set your own proxy under **⚙ Settings** (use `{url}` as the placeholder).

You can also skip MFL entirely with **Start from scratch** → blank teams to rename.

### Pre-built board for "Loyal Order of Water Buffaloes" (league 21931)

`loyal-order-2026.json` is your league baked into a board file — 10 teams, linear
7-round order, and the 8 traded picks that existed when it was generated. Load it
in one step: **⚙ → Import JSON → pick that file**. To refresh trades later, re-run
the manual import step 2 (paste the latest `draftResults`); MFL is the source of truth.

## Run locally

It's just static files — open `index.html`, or serve the folder:

```bash
# Python
python -m http.server 8000
# or Node
npx serve .
```

Then visit `http://localhost:8000`.

## Deploy to GitHub Pages

1. Create a repo and push these files (`index.html`, `styles.css`, `app.js`,
   `.nojekyll`) to the `main` branch.
   ```bash
   git init && git add . && git commit -m "Dynasty draft board"
   git branch -M main
   git remote add origin https://github.com/<you>/<repo>.git
   git push -u origin main
   ```
2. On GitHub: **Settings → Pages → Build and deployment**, set
   **Source = Deploy from a branch**, **Branch = `main` / `(root)`**, Save.
3. Your board is live at `https://<you>.github.io/<repo>/` in a minute or two.

The `.nojekyll` file tells Pages to serve the files as-is (no Jekyll processing).

## How to run a draft

1. **League setup** → enter season + league ID → **Fetch teams** (or paste, or
   start from scratch). Set rounds and snake on/off.
2. Drag the team list into your draft order (row order = round-1 order).
3. As the draft runs, use the **on-the-clock bar**: type the player → Enter.
   Or click any cell on the board to edit it directly.
4. For a **trade**, click **↔ Record trade** (or the pick on the board) and pick
   the new owner. The traded pick gets a `→ NewOwner` badge.
5. Hit **🖨 Print** for a clean, shareable board.

## Data & privacy

Everything lives in `localStorage` under the key `ddb.state.v1` on your device.
Clearing browser data wipes it — use **⚙ → Export JSON** to back up a board.

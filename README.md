# The Lineup

A daily logic-grid puzzle game. Place items into colored rows using deduction clues — auto-generated, unique-solution-guaranteed, new puzzle every day.

## What's new in this version
- **Daily Case mode** — same puzzle for everyone each day (seeded off the date), with a "Practice" mode for unlimited random puzzles at 5/6/7-row difficulty.
- **Persistence** — your board, struck clues, and timer survive a page refresh (stored in `localStorage`).
- **Streaks & stats** — tracks daily streak and total solved, also in `localStorage`.
- **Share Results** — after solving, copies a spoiler-free summary (time + evidence used) to your clipboard.

## Local development
```bash
npm install
npm run dev
```
Opens at `http://localhost:5173`.

## Deploy via GitHub + Netlify
1. Push this folder to a new GitHub repo.
2. In Netlify: **Add new site → Import an existing project → GitHub** → pick the repo.
3. Build settings are already set via `netlify.toml`:
   - Build command: `npm run build`
   - Publish directory: `dist`
4. Deploy. Every push to your main branch auto-redeploys.

## Notes
- No backend — everything (including "daily" puzzle generation) runs client-side, seeded off the visitor's local date. Good enough for personal/portfolio use; if you ever want every visitor worldwide locked to the same calendar day regardless of timezone, that needs a server-side date source.
- `localStorage` is per-browser. Stats/streaks won't follow you across devices.

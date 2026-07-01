# QuiltDrop

A cozy, self-contained logic puzzle game. It blends **Shikaku/Patches** deduction (each colored zone shows its exact area) with a **block-drop** feel (pick shaped pieces from a queue and drop them to fill each zone exactly).

Everything lives in a single `index.html` — vanilla HTML/CSS/JS, no frameworks, no build step. Just open it.

## Play

Open `index.html` in any modern browser, or serve the folder:

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

## How it works

- Each colored **zone** has a clue number = the number of cells it covers.
- **Drag** a piece from the queue onto its matching zone — a live preview shows exactly where it lands. (You can also tap a piece to select it, then tap the board.)
- Nothing is stuck: **drag an already-placed piece** to reposition it, or drag it off its zone to send it back to the tray.
- A wrong-zone or overflowing **tap** costs a **heart** (3 total); dragging is forgiving. Running out of hearts or moves ends the run.
- Fill every zone exactly to complete the quilt. Faster finishes earn more stars (up to 3).
- **Hint** highlights a valid placement (costs a move), **Undo** reverts the last action, **Restart** resets the level.

## Features

- **Home screen** with the next level and the daily puzzle
- **60 levels** with a tutorial → easy → medium → hard difficulty curve that keeps ramping (4×4 and 5×5 boards, 2–5 zones)
- **Level select** (hold the level card, or tap the progress sub-label) showing stars per level. This dev build sets `DEV_UNLOCK_ALL = true`, so every level is selectable; flip it off in `index.html` to restore progressive unlocking.
- **Daily Quilt** — one of 30 puzzles chosen by the day of the year, completion tracked per date
- **Progress, stars, and daily completion** persisted in `localStorage`
- **Settings** — sound toggle and reset progress
- Accessible: respects `prefers-reduced-motion`, fits a 375px mobile viewport with no horizontal scroll

## Level generation

Levels and daily puzzles are not hand-authored cell by cell. They are produced by `build-levels.js` (a dev tool, not loaded by the game), which:

1. Partitions a board into contiguous zones via seeded region growing.
2. Tiles each zone by carving connected polyomino pieces directly from a real partition — so a valid solution is guaranteed to exist.
3. Verifies every level both by area-matching and by running a backtracking solver that mirrors the in-game placement logic.

The generator uses a fixed seed, so its output is deterministic. The final game ships only the generated data inlined into `index.html`. To regenerate:

```
node build-levels.js index.html
```

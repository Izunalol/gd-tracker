# GD Tracker

A readable dashboard for the data the **Death Tracker** Geode mod (by abb2k, `elohmrow.death_tracker`) records while you play Geometry Dash.

## What it shows

- **Levels gallery** — every tracked level as a card with its thumbnail, difficulty, list placement, best %, attempts, playtime and when you last played it (completed levels get a glowing tick). Sort by last played, attempts, playtime, best %, name, difficulty (list placement first, then the in-game face), enjoyment, length, sessions and more; filter by type, completion, difficulty, demon list, length, tags and favourites; group by difficulty, list, length, status, type, tag or month. There is also a sortable table view and a CSV export.
- **Level page** — headline numbers, deaths per percent (count, death rate or reach curve), the hardest parts of the level, best per session, where your playtime went, every session (expandable), practice / start-pos runs grouped by start position, a per-percent table and your notes. Any chart can be narrowed to a single session.
- **Lists** — the Pointercrate Demonlist and AREDL with your progress on every level: completed, best %, attempts and playtime, plus what you've beaten and what you're closest to.
- **Linked copies** — start-pos copies, editor copies and re-uploads of the same level can be linked into one card with combined stats and one thumbnail. Likely copies are detected automatically (same name once "startpos"/"copy"-style suffixes are removed, or linked in Death Tracker) and offered for review.
- **Activity** — playtime per day or week, a 12-month calendar, your most played levels and the latest sessions across all levels.
- **Live refresh** — the app watches the Death Tracker folder and updates when the mod saves (on leaving a level).

## Customisation

- Per level: custom thumbnail (pick a file, paste, use a URL, or drop an image onto a card), focal point, display name, enjoyment rating (half stars), your own difficulty placement (marked as manual), length, colour, tags, notes, favourite and hide. A tucked-away "Adjust stats" section adds attempts, playtime, runs or a best % from before you installed Death Tracker.
- App-wide: dark/light/system theme, accent colour, font, corner roundness, density, background (plain, accent glow or your own image with blur/dim), card style, shape, size and which stats appear on cards, time and date formats, and what counts as playtime (respawn and pause time).

## Data

- **Reads** `%LOCALAPPDATA%\GeometryDash\geode\mods\elohmrow.death_tracker\levels` (or the mod's custom save path). It never writes there.
- **Stores** its own settings, custom images and caches in `%LOCALAPPDATA%\GD Tracker` (`GDTRACKER_DATA` overrides it). Settings → Backup exports everything to one .zip.
- **Online extras** (each can be switched off in Settings): level info (creator, stars, song, length) from the Geometry Dash servers, thumbnails from the Level Thumbnails mod's server (`levelthumbs.prevter.me`), and the Pointercrate and AREDL lists (refreshed every 6 hours). All are cached.
- **Difficulty placement**: Pointercrate position for the top 150, otherwise the AREDL position, otherwise your own number. Levels are matched by ID; editor copies and start-pos uploads (which have their own IDs) are matched by name.

## Death Tracker file format (for reference)

| File | Contents |
| --- | --- |
| `metadata` | `levelName`, `attempts` (GD's own counter), `difficulty` (-1 auto, 0 N/A, 1–5 Easy…Insane, 6 Hard demon, 7 Easy, 8 Medium, 9 Insane, 10 Extreme), `LinkedLevels`, `sections` |
| `general.dt` | all-time `deaths` (`"percent": count`, from-0 normal-mode attempts; 100 = completion), `runs` (`"start-end": count`, practice/start-pos), `newBests`, playtime in nanoseconds split into `playtimeGeneral` / `playtimeDead` / `playtimePaused`, each with from-0 (`playtimeF0`) and practice (`playtimeRuns`) parts |
| `sessions/<start>.dt` | `sessionStartDate`, `lastPlayed` (unix seconds) and `data` in the same shape as `general.dt` |

Level keys: `<id>` online, `<id>-local` main levels, `<id>-editor` your own levels, `-daily` / `-gauntlet` suffixes.

## Building

Requires the .NET 8 SDK and the WebView2 runtime (built into Windows 11).

```powershell
.\build.ps1   # → dist\GDTracker.exe (self-contained, single file)
```

For UI development, run with `GDTRACKER_DEV=1` (enables dev tools) and `GDTRACKER_UI_DIR=<path to src\GDTracker\wwwroot>` to load the UI from disk instead of the embedded copy.

# GD Tracker

A readable dashboard for the data the **Death Tracker** Geode mod (by abb2k, `elohmrow.death_tracker`) records while you play Geometry Dash.

## What it shows

- **Levels gallery** — every tracked level as a card with its thumbnail, difficulty, best %, attempts, playtime and when you last played it. Sort by last played, attempts, playtime, best %, name, difficulty, sessions and more; filter by type, completion, difficulty, tags and favourites; group by difficulty, status, type, tag or month. There is also a sortable table view and a CSV export.
- **Level page** — headline numbers, deaths per percent (count, death rate or reach curve), the hardest parts of the level, best per session, where your playtime went, every session (expandable), practice / start-pos runs grouped by start position, a per-percent table and your notes. Any chart can be narrowed to a single session.
- **Activity** — playtime per day or week, a 12-month calendar, your most played levels and the latest sessions across all levels.
- **Live refresh** — the app watches the Death Tracker folder and updates when the mod saves (on leaving a level).

## Customisation

- Per level: custom thumbnail (pick a file, paste, use a URL, or drop an image onto a card), focal point, display name, colour, tags, notes, favourite and hide.
- App-wide: dark/light/system theme, accent colour, font, corner roundness, density, background (plain, accent glow or your own image with blur/dim), card style, shape, size and which stats appear on cards, time and date formats, and what counts as playtime (respawn and pause time).

## Data

- **Reads** `%LOCALAPPDATA%\GeometryDash\geode\mods\elohmrow.death_tracker\levels` (or the mod's custom save path). It never writes there.
- **Stores** its own settings, custom images and caches in `%LOCALAPPDATA%\GD Tracker` (`GDTRACKER_DATA` overrides it). Settings → Backup exports everything to one .zip.
- **Online extras** (both can be switched off in Settings): level info (creator, stars, song, length) from the Geometry Dash servers, and thumbnails from the Level Thumbnails mod's server (`levelthumbs.prevter.me`). Both are cached.

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

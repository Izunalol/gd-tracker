# GD Tracker

A readable dashboard for the data the **Death Tracker** Geode mod (by abb2k, `elohmrow.death_tracker`) records while you play Geometry Dash.

## Download

**[⬇ Download GDTracker.exe](https://github.com/Izunalol/gd-tracker/releases/latest/download/GDTracker.exe)** (latest version) · [all releases](https://github.com/Izunalol/gd-tracker/releases)

It's a single self-contained file: no install, no .NET needed. It runs on Windows 10/11 with the Microsoft Edge WebView2 runtime (built into Windows 11). Windows may show a SmartScreen warning the first time because the exe isn't code-signed. Click **More info → Run anyway**.

You need the [Death Tracker](https://geode-sdk.org/mods/elohmrow.death_tracker) mod installed in Geode for there to be anything to show.

## What it shows

- **Levels gallery** — every tracked level as a card with its thumbnail, difficulty, list placement, best %, attempts, playtime and when you last played it (completed levels get a glowing tick). Sort by last played, attempts, playtime, best %, name, difficulty (list placement first, then the in-game face), enjoyment, length, sessions and more; filter by type, completion, difficulty, demon list, length, tags and favourites; group by difficulty, list, length, status, type, tag or month. There is also a sortable table view and a CSV export.
- **Level page** — headline numbers, deaths per percent (count, death rate or reach curve), the hardest parts of the level, best per session, where your playtime went, every session (expandable), practice / start-pos runs grouped by start position, a per-percent table and your notes. Any chart can be narrowed to a single session.
- **Lists** — the Pointercrate Demonlist, the Challenge List, AREDL and the Impossible Levels List with your progress on every level, plus each list's **leaderboard**. Click a player (on the leaderboard, as a publisher/verifier/creator, or among a level's victors) to see their profile like on the website: rank, score, completions, verifications, progress records, published and created levels. Click a level to see its victors (or record runs on the Impossible Levels List). Levels you've beaten are ticked on other players' profiles too.
- **Linked copies** — start-pos copies, editor copies and re-uploads of the same level can be linked into one card with combined stats and one thumbnail. Likely copies are detected automatically (same name once "startpos"/"copy"-style suffixes are removed, or linked in Death Tracker) and offered for review.
- **Statistics** — your career (levels and demons beaten, hardest completions, completions by difficulty and over time, most attempts to beat, closest to beating, highest rated) and activity over a chosen range (playtime per day or week, a 12-month calendar, most played levels, recent sessions).
- **Add levels you haven't played** — search the GD servers (like the in-game search) or the Demonlist / AREDL and add levels to rate them, link videos or mark them completed. Death Tracker data takes over once you play them.
- **Videos** — link YouTube videos to a level as your completion or a showcase; titles fill in automatically and a video can become the level's thumbnail.
- **Live refresh** — the app watches the Death Tracker folder and updates when the mod saves (on leaving a level).

## Customisation

- Per level: custom thumbnail (pick a file, paste, use a URL, or drop an image onto a card), focal point, display name, enjoyment rating (half stars), your own difficulty placement (marked as manual), length, colour, tags, notes, favourite and hide. A tucked-away "Adjust stats" section adds attempts, playtime, runs or a best % from before you installed Death Tracker.
- List placements can be corrected per level: "Not this level", or pick the right Demonlist/AREDL entry. Levels beaten outside Death Tracker can be marked completed.
- App-wide: dark/light/system theme, accent colour, font, corner roundness, density, background (plain, accent glow or your own image with blur/dim), card style, shape, size and which stats appear on cards, Geometry Dash difficulty faces instead of names (read from your own GD install, never shipped with the app), time and date formats, and what counts as playtime (respawn and pause time).

## Data

- **Reads** `%LOCALAPPDATA%\GeometryDash\geode\mods\elohmrow.death_tracker\levels` (or the mod's custom save path). It never writes there.
- **Stores** its own settings, custom images and caches in `%LOCALAPPDATA%\GD Tracker` (`GDTRACKER_DATA` overrides it). Settings → Backup exports everything to one .zip.
- **Online extras** (each can be switched off in Settings): level info (creator, stars, song, length) from the Geometry Dash servers, thumbnails from the Level Thumbnails mod's server (`levelthumbs.prevter.me`), the community lists (refreshed every 6 hours; leaderboards and profiles are fetched live and cached for 10 minutes), and YouTube search for adding videos. Lists: pointercrate.com, challengelist.gd, api.aredl.net, api.impossiblelevels.com.
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

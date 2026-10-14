using System.Net;
using System.Text;

namespace GDTracker;

/// <summary>
/// Optional online extras: level details from the official GD servers (creator, stars, song…) and
/// level thumbnails from the Level Thumbnails mod's server. Both are cached under cache/ so they're
/// only fetched once.
/// </summary>
public static class GdOnline
{
    const string GdSearch = "https://www.boomlings.com/database/getGJLevels21.php";
    const string ThumbBase = "https://levelthumbs.prevter.me/thumbnail/";
    static readonly TimeSpan RetryMissing = TimeSpan.FromDays(7);

    static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        AutomaticDecompression = DecompressionMethods.All,
        ConnectTimeout = TimeSpan.FromSeconds(10),
    }) { Timeout = TimeSpan.FromSeconds(25) };

    static readonly SemaphoreSlim InfoLock = new(1, 1);

    public record LevelInfo
    {
        public long Id { get; init; }
        public bool Missing { get; init; }
        public long Fetched { get; init; }
        public string? Name { get; init; }
        public string? Creator { get; init; }
        public string? Description { get; init; }
        public int Stars { get; init; }
        public int Difficulty { get; init; }
        public int Length { get; init; }
        public long Downloads { get; init; }
        public long Likes { get; init; }
        public int Featured { get; init; }
        public int Epic { get; init; }
        public int Objects { get; init; }
        public int Coins { get; init; }
        public bool VerifiedCoins { get; init; }
        public string? Song { get; init; }
        public string? SongArtist { get; init; }
        public int GameVersion { get; init; }
    }

    public static Dictionary<string, LevelInfo> Cached() =>
        Json.Read<Dictionary<string, LevelInfo>>(AppPaths.LevelInfo) ?? new();

    /// <summary>Fetches info for ids not in the cache (or all of them when <paramref name="force"/>), then returns the whole cache.</summary>
    public static async Task<Dictionary<string, LevelInfo>> Fetch(IEnumerable<long> ids, bool force)
    {
        await InfoLock.WaitAsync();
        try
        {
            var cache = Cached();
            var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
            var todo = ids.Where(id => id > 0).Distinct().Where(id =>
                force || !cache.TryGetValue(id.ToString(), out var c) ||
                (c.Missing && now - c.Fetched > RetryMissing.TotalSeconds)).ToList();
            bool changed = false;
            // The servers page results 10 at a time; go gently to stay under their rate limit.
            foreach (var chunk in todo.Chunk(10))
            {
                string body;
                try { body = await Search(chunk); }
                catch { break; } // offline or rate-limited: keep what we have
                if (body.StartsWith("error code", StringComparison.OrdinalIgnoreCase)) break;
                var found = Parse(body, now);
                foreach (var id in chunk)
                    cache[id.ToString()] = found.TryGetValue(id, out var info) ? info : new LevelInfo { Id = id, Missing = true, Fetched = now };
                changed = true;
                await Task.Delay(450);
            }
            if (changed) Json.Write(AppPaths.LevelInfo, cache);
            return cache;
        }
        finally { InfoLock.Release(); }
    }

    /// <summary>Searches the GD servers like the in-game search (a number finds that level ID). Results are cached as level info.</summary>
    public static async Task<List<LevelInfo>> SearchText(string query, int page)
    {
        query = query.Trim();
        if (query.Length == 0) return new();
        using var req = new HttpRequestMessage(HttpMethod.Post, GdSearch)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["secret"] = "Wmfd2893gb7",
                ["type"] = "0",
                ["str"] = query,
                ["page"] = Math.Max(0, page).ToString(),
            }),
        };
        req.Headers.TryAddWithoutValidation("User-Agent", "");
        using var res = await Http.SendAsync(req);
        var body = (await res.Content.ReadAsStringAsync()).Trim();
        if (body.StartsWith("error code", StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("The GD servers are rate-limiting searches; try again in a minute.");
        var now = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        // Keep server order (the search ranks by relevance).
        var order = body.Split('#')[0].Split('|').Select(l => KeyValues(l, ":").GetValueOrDefault("1")).ToList();
        var found = Parse(body, now);
        var list = order.Select(id => long.TryParse(id, out var v) && found.TryGetValue(v, out var info) ? info : null).Where(x => x != null).Cast<LevelInfo>().ToList();
        if (list.Count > 0)
        {
            await InfoLock.WaitAsync();
            try
            {
                var cache = Cached();
                foreach (var i in list) cache[i.Id.ToString()] = i;
                Json.Write(AppPaths.LevelInfo, cache);
            }
            finally { InfoLock.Release(); }
        }
        return list;
    }

    static async Task<string> Search(IEnumerable<long> ids)
    {
        using var req = new HttpRequestMessage(HttpMethod.Post, GdSearch)
        {
            Content = new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["secret"] = "Wmfd2893gb7",
                ["type"] = "19",
                ["str"] = string.Join(",", ids),
                ["page"] = "0",
            }),
        };
        // The GD servers reject requests that carry a browser-like User-Agent.
        req.Headers.TryAddWithoutValidation("User-Agent", "");
        using var res = await Http.SendAsync(req);
        return (await res.Content.ReadAsStringAsync()).Trim();
    }

    static Dictionary<long, LevelInfo> Parse(string body, long now)
    {
        var result = new Dictionary<long, LevelInfo>();
        if (body.Length < 3 || body == "-1") return result;
        var sections = body.Split('#');
        var creators = new Dictionary<string, string>();
        if (sections.Length > 1)
            foreach (var c in sections[1].Split('|'))
            {
                var p = c.Split(':');
                if (p.Length >= 2) creators[p[0]] = p[1];
            }
        var songs = new Dictionary<string, (string Name, string Artist)>();
        if (sections.Length > 2)
            foreach (var s in sections[2].Split("~:~"))
            {
                var kv = KeyValues(s, "~|~");
                if (kv.TryGetValue("1", out var sid)) songs[sid] = (kv.GetValueOrDefault("2", ""), kv.GetValueOrDefault("4", ""));
            }

        foreach (var lvl in sections[0].Split('|'))
        {
            var kv = KeyValues(lvl, ":");
            if (!kv.TryGetValue("1", out var idStr) || !long.TryParse(idStr, out var id)) continue;
            int I(string k) => int.TryParse(kv.GetValueOrDefault(k), out var v) ? v : 0;
            long L(string k) => long.TryParse(kv.GetValueOrDefault(k), out var v) ? v : 0;

            string? song = null, artist = null;
            var custom = kv.GetValueOrDefault("35", "0");
            if (custom != "0" && songs.TryGetValue(custom, out var sng)) (song, artist) = sng;
            else if (custom == "0" && OfficialSongs.TryGetValue(I("12"), out var off)) (song, artist) = (off, "RobTop");

            result[id] = new LevelInfo
            {
                Id = id,
                Fetched = now,
                Name = kv.GetValueOrDefault("2"),
                Creator = creators.GetValueOrDefault(kv.GetValueOrDefault("6", "")),
                Description = DecodeDescription(kv.GetValueOrDefault("3")),
                Stars = I("18"),
                Difficulty = Difficulty(kv),
                Length = I("15"),
                Downloads = L("10"),
                Likes = L("14"),
                Featured = I("19"),
                Epic = I("42"),
                Objects = I("45"),
                Coins = I("37"),
                VerifiedCoins = I("38") == 1,
                Song = song,
                SongArtist = artist,
                GameVersion = I("13"),
            };
        }
        return result;
    }

    /// <summary>Same scale the mod stores: -1 auto, 0 N/A, 1–5 Easy…Insane, 6 Hard demon, 7 Easy, 8 Medium, 9 Insane, 10 Extreme.</summary>
    static int Difficulty(Dictionary<string, string> kv)
    {
        if (kv.GetValueOrDefault("25") == "1") return -1;
        if (kv.GetValueOrDefault("17") == "1")
        {
            int d = int.TryParse(kv.GetValueOrDefault("43"), out var v) ? v : 0;
            return 6 + (d >= 3 ? d - 2 : d);
        }
        int num = int.TryParse(kv.GetValueOrDefault("9"), out var n) ? n : 0;
        return Math.Clamp(num / 10, 0, 5);
    }

    static string? DecodeDescription(string? b64)
    {
        if (string.IsNullOrEmpty(b64)) return null;
        try
        {
            var s = b64.Replace('-', '+').Replace('_', '/');
            s = s.PadRight(s.Length + (4 - s.Length % 4) % 4, '=');
            return Encoding.UTF8.GetString(Convert.FromBase64String(s));
        }
        catch { return null; }
    }

    static Dictionary<string, string> KeyValues(string s, string sep)
    {
        var parts = s.Split(sep);
        var kv = new Dictionary<string, string>();
        for (int i = 0; i + 1 < parts.Length; i += 2) kv[parts[i]] = parts[i + 1];
        return kv;
    }

    static readonly Dictionary<int, string> OfficialSongs = new()
    {
        [0] = "Stereo Madness", [1] = "Back On Track", [2] = "Polargeist", [3] = "Dry Out", [4] = "Base After Base",
        [5] = "Can't Let Go", [6] = "Jumper", [7] = "Time Machine", [8] = "Cycles", [9] = "xStep", [10] = "Clutterfunk",
        [11] = "Theory of Everything", [12] = "Electroman Adventures", [13] = "Clubstep", [14] = "Electrodynamix",
        [15] = "Hexagon Force", [16] = "Blast Processing", [17] = "Theory of Everything 2", [18] = "Geometrical Dominator",
        [19] = "Deadlocked", [20] = "Fingerdash", [21] = "Dash",
    };

    // ---------------------------------------------------------------- thumbnails

    static string ThumbFile(long id, bool hd) => Path.Combine(AppPaths.LevelThumbs, hd ? $"{id}-hd.webp" : $"{id}.webp");
    static string MissingFile(long id) => Path.Combine(AppPaths.LevelThumbs, $"{id}.none");
    public static string ThumbUrl(long id, bool hd) => $"cache/levelthumbs/{id}{(hd ? "-hd" : "")}.webp";

    /// <summary>Which ids already have a cached thumbnail (url), are known to have none (null), or still need fetching (absent).</summary>
    public static Dictionary<string, string?> CachedThumbs(IEnumerable<long> ids, bool hd)
    {
        var map = new Dictionary<string, string?>();
        foreach (var id in ids.Distinct())
        {
            if (File.Exists(ThumbFile(id, hd))) map[id.ToString()] = ThumbUrl(id, hd);
            else if (IsKnownMissing(id)) map[id.ToString()] = null;
        }
        return map;
    }

    static bool IsKnownMissing(long id)
    {
        var f = MissingFile(id);
        return File.Exists(f) && DateTime.UtcNow - File.GetLastWriteTimeUtc(f) < RetryMissing;
    }

    /// <summary>Downloads one thumbnail if needed; returns its url (relative to the data host) or null when the level has none.</summary>
    public static async Task<string?> Thumb(long id, bool hd)
    {
        var path = ThumbFile(id, hd);
        if (File.Exists(path)) return ThumbUrl(id, hd);
        if (IsKnownMissing(id)) return null;
        using var res = await Http.GetAsync(ThumbBase + id + (hd ? "" : "/small"));
        if (res.StatusCode == HttpStatusCode.NotFound)
        {
            File.WriteAllText(MissingFile(id), "");
            return null;
        }
        res.EnsureSuccessStatusCode();
        var bytes = await res.Content.ReadAsByteArrayAsync();
        if (bytes.Length < 64) return null;
        var tmp = path + ".tmp";
        await File.WriteAllBytesAsync(tmp, bytes);
        File.Move(tmp, path, true);
        return ThumbUrl(id, hd);
    }

    public static void ClearThumbCache()
    {
        foreach (var f in Directory.GetFiles(AppPaths.LevelThumbs))
            try { File.Delete(f); } catch { }
    }
}

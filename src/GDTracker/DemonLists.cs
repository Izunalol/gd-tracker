using System.Net;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace GDTracker;

/// <summary>
/// Community demon lists: Pointercrate (the Demonlist) and AREDL (All Rated Extreme Demons List).
/// Both are fetched in full, trimmed to the fields the UI uses and cached in cache/lists/.
/// </summary>
public static class DemonLists
{
    static readonly TimeSpan MaxAge = TimeSpan.FromHours(6);
    static readonly string Dir = Path.Combine(AppPaths.Cache, "lists");
    static readonly SemaphoreSlim Lock = new(1, 1);

    static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        AutomaticDecompression = DecompressionMethods.All,
        ConnectTimeout = TimeSpan.FromSeconds(10),
    }) { Timeout = TimeSpan.FromSeconds(40) };

    static DemonLists()
    {
        Http.DefaultRequestHeaders.TryAddWithoutValidation("User-Agent", "GDTracker/1.0 (personal stats viewer)");
        Http.DefaultRequestHeaders.TryAddWithoutValidation("Accept", "application/json");
    }

    public static readonly string[] Names = { "pointercrate", "challenge", "aredl", "ill" };

    /// <summary>Returns { fetched, levels, stale, error }. Uses the cache unless it's old or <paramref name="force"/> is set; falls back to the cache when offline.</summary>
    public static async Task<object> Get(string name, bool force, bool allowNetwork)
    {
        if (!Names.Contains(name)) throw new InvalidOperationException("Unknown list.");
        Directory.CreateDirectory(Dir);
        var path = Path.Combine(Dir, name + ".json");
        await Lock.WaitAsync();
        try
        {
            var fresh = File.Exists(path) && DateTime.UtcNow - File.GetLastWriteTimeUtc(path) < MaxAge;
            string? error = null;
            if (allowNetwork && (force || !fresh))
            {
                try
                {
                    var levels = name switch
                    {
                        "pointercrate" => await FetchPointercrate("https://pointercrate.com"),
                        "challenge" => await FetchPointercrate("https://challengelist.gd"),
                        "aredl" => await FetchAredl(),
                        _ => await FetchIll(),
                    };
                    Json.WriteText(path, levels.ToJsonString());
                }
                catch (Exception ex) { error = ex.Message; }
            }
            if (!File.Exists(path)) return new { fetched = 0L, levels = Array.Empty<object>(), stale = true, error = error ?? "Not downloaded yet." };
            var fetched = new DateTimeOffset(File.GetLastWriteTimeUtc(path)).ToUnixTimeSeconds();
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(path));
            return new { fetched, levels = doc.RootElement.Clone(), stale = DateTime.UtcNow - File.GetLastWriteTimeUtc(path) >= MaxAge, error };
        }
        finally { Lock.Release(); }
    }

    /// <summary>Pointercrate and its forks (the Challenge List) share one API.</summary>
    static async Task<JsonArray> FetchPointercrate(string site)
    {
        var all = new JsonArray();
        // Paged 100 at a time by position ("after" = last position seen).
        for (int after = 0, page = 0; page < 20; page++)
        {
            var text = await Http.GetStringAsync($"{site}/api/v2/demons/listed/?limit=100&after={after}");
            var arr = JsonNode.Parse(text) as JsonArray;
            if (arr == null || arr.Count == 0) break;
            foreach (var d in arr)
            {
                if (d == null) continue;
                all.Add(new JsonObject
                {
                    ["position"] = d["position"]?.GetValue<int>(),
                    ["name"] = d["name"]?.GetValue<string>(),
                    ["levelId"] = d["level_id"]?.DeepClone(),
                    ["publisher"] = d["publisher"]?["name"]?.GetValue<string>(),
                    ["publisherId"] = d["publisher"]?["id"]?.DeepClone(),
                    ["verifier"] = d["verifier"]?["name"]?.GetValue<string>(),
                    ["verifierId"] = d["verifier"]?["id"]?.DeepClone(),
                    ["fps"] = d["fps"]?.DeepClone(),
                    ["video"] = d["video"]?.GetValue<string>(),
                    ["thumbnail"] = d["thumbnail"]?.GetValue<string>(),
                    ["requirement"] = d["requirement"]?.DeepClone(),
                    ["id"] = d["id"]?.DeepClone(),
                });
                after = Math.Max(after, d["position"]?.GetValue<int>() ?? after);
            }
            if (arr.Count < 100) break;
        }
        if (all.Count == 0) throw new InvalidOperationException("The list returned no levels.");
        return all;
    }

    /// <summary>
    /// The Impossible Levels List. Its level feed bundles every level's record runs (impossible levels
    /// are never beaten, so a "record" is a start→end % run); we keep the runs for the victors view.
    /// </summary>
    static async Task<JsonArray> FetchIll()
    {
        var text = await Http.GetStringAsync("https://api.impossiblelevels.com/api/Levels/details");
        var arr = JsonNode.Parse(text) as JsonArray ?? throw new InvalidOperationException("The Impossible Levels List returned no levels.");
        var all = new List<JsonObject>();
        foreach (var item in arr)
        {
            var l = item?["level"];
            if (l == null || l["visible"]?.GetValue<bool>() == false) continue;
            var runs = new JsonArray();
            if (item!["records"] is JsonArray recs)
                foreach (var r in recs)
                    runs.Add(new JsonObject
                    {
                        ["player"] = r?["player"]?.GetValue<string>(),
                        ["start"] = r?["startDistance"]?.DeepClone(),
                        ["end"] = r?["endDistance"]?.DeepClone(),
                        ["video"] = r?["videoUrl"]?.GetValue<string>(),
                        ["slug"] = r?["playerProfileSlug"]?.DeepClone(),
                        ["date"] = r?["createdAt"]?.GetValue<string>(),
                    });
            all.Add(new JsonObject
            {
                ["id"] = l["id"]?.DeepClone(),
                ["position"] = l["rank"]?.DeepClone(),
                ["name"] = l["name"]?.GetValue<string>(),
                ["levelId"] = long.TryParse(l["levelId"]?.GetValue<string>(), out var gid) ? gid : null,
                ["publisher"] = l["uploader"]?.GetValue<string>(),
                ["rating"] = l["rating"]?.DeepClone(),
                ["fps"] = l["fps"]?.DeepClone(),
                ["seconds"] = l["levelLength"]?.DeepClone(),
                ["video"] = l["showcaseLink"]?.GetValue<string>(),
                ["uncleared"] = l["uncleared"]?.DeepClone(),
                ["published"] = l["datePublished"]?.GetValue<string>(),
                ["records"] = runs,
            });
        }
        if (all.Count == 0) throw new InvalidOperationException("The Impossible Levels List returned no levels.");
        // The feed's order isn't guaranteed; rank is the list position.
        return new JsonArray(all.OrderBy(n => n["position"]?.GetValue<int?>() ?? int.MaxValue).ToArray<JsonNode?>());
    }

    // ---------------------------------------------------------------- live API proxy

    static readonly HashSet<string> ApiHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "pointercrate.com", "challengelist.gd", "api.aredl.net", "api.impossiblelevels.com",
    };
    static readonly Dictionary<string, (DateTime At, string Body)> Recent = new();

    /// <summary>
    /// GET a JSON endpoint of one of the list sites (leaderboards, player profiles, victors). The page can't
    /// call them directly (CORS), and a 10-minute memory cache keeps clicking around snappy and polite.
    /// </summary>
    public static async Task<JsonElement> Api(string url)
    {
        if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || u.Scheme != "https" || !ApiHosts.Contains(u.Host))
            throw new InvalidOperationException("That list isn't supported.");
        lock (Recent)
        {
            if (Recent.TryGetValue(url, out var hit) && DateTime.UtcNow - hit.At < TimeSpan.FromMinutes(10))
                return JsonDocument.Parse(hit.Body).RootElement.Clone();
        }
        using var res = await Http.GetAsync(u);
        var body = await res.Content.ReadAsStringAsync();
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException((int)res.StatusCode == 404 ? "Not found on the list." : $"{u.Host} answered {(int)res.StatusCode}.");
        using var doc = JsonDocument.Parse(body);
        lock (Recent)
        {
            if (Recent.Count > 300) Recent.Clear();
            Recent[url] = (DateTime.UtcNow, body);
        }
        return doc.RootElement.Clone();
    }

    static async Task<JsonArray> FetchAredl()
    {
        var text = await Http.GetStringAsync("https://api.aredl.net/v2/api/aredl/levels");
        var arr = JsonNode.Parse(text) as JsonArray ?? throw new InvalidOperationException("AREDL returned no levels.");
        var all = new JsonArray();
        foreach (var d in arr)
        {
            if (d == null) continue;
            all.Add(new JsonObject
            {
                ["position"] = d["position"]?.DeepClone(),
                ["name"] = d["name"]?.GetValue<string>(),
                ["levelId"] = d["level_id"]?.DeepClone(),
                ["points"] = d["points"]?.DeepClone(),
                ["legacy"] = d["status"]?.GetValue<string>() == "Legacy",
                ["twoPlayer"] = d["two_player"]?.DeepClone(),
                ["tags"] = d["tags"]?.DeepClone(),
                ["enjoyment"] = d["edel_enjoyment"]?.DeepClone(),
                ["gddlTier"] = d["gddl_tier"]?.DeepClone(),
                ["nlwTier"] = d["nlw_tier"]?.DeepClone(),
            });
        }
        return all;
    }
}

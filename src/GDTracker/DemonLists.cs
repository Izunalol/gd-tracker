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

    public static readonly string[] Names = { "pointercrate", "aredl" };

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
                    var levels = name == "pointercrate" ? await FetchPointercrate() : await FetchAredl();
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

    static async Task<JsonArray> FetchPointercrate()
    {
        var all = new JsonArray();
        // Paged 100 at a time by position ("after" = last position seen).
        for (int after = 0, page = 0; page < 20; page++)
        {
            var text = await Http.GetStringAsync($"https://pointercrate.com/api/v2/demons/listed/?limit=100&after={after}");
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
                    ["verifier"] = d["verifier"]?["name"]?.GetValue<string>(),
                    ["video"] = d["video"]?.GetValue<string>(),
                    ["thumbnail"] = d["thumbnail"]?.GetValue<string>(),
                    ["requirement"] = d["requirement"]?.DeepClone(),
                    ["id"] = d["id"]?.DeepClone(),
                });
                after = Math.Max(after, d["position"]?.GetValue<int>() ?? after);
            }
            if (arr.Count < 100) break;
        }
        if (all.Count == 0) throw new InvalidOperationException("Pointercrate returned no levels.");
        return all;
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

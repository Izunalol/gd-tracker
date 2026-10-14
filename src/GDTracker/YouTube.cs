using System.Net;
using System.Text.Json;

namespace GDTracker;

/// <summary>
/// YouTube search without an API key: the results page embeds its data as JSON (ytInitialData),
/// which we read the video entries out of.
/// </summary>
public static class YouTube
{
    static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        AutomaticDecompression = DecompressionMethods.All,
        ConnectTimeout = TimeSpan.FromSeconds(10),
        UseCookies = false,
    }) { Timeout = TimeSpan.FromSeconds(20) };

    public record Video(string Id, string Title, string? Channel, string? Duration, string? Views, string? Published);

    public static async Task<List<Video>> Search(string query)
    {
        query = query.Trim();
        if (query.Length == 0) return new();
        using var req = new HttpRequestMessage(HttpMethod.Get, "https://www.youtube.com/results?search_query=" + Uri.EscapeDataString(query));
        req.Headers.TryAddWithoutValidation("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36");
        req.Headers.TryAddWithoutValidation("Accept-Language", "en-US,en;q=0.9");
        // Skips the cookie-consent interstitial shown in some regions.
        req.Headers.TryAddWithoutValidation("Cookie", "SOCS=CAI; CONSENT=YES+");
        using var res = await Http.SendAsync(req);
        res.EnsureSuccessStatusCode();
        var html = await res.Content.ReadAsStringAsync();

        const string marker = "var ytInitialData = ";
        int start = html.IndexOf(marker, StringComparison.Ordinal);
        if (start < 0) throw new InvalidOperationException("YouTube didn't return search results (it may have changed its page).");
        start += marker.Length;
        int end = html.IndexOf(";</script>", start, StringComparison.Ordinal);
        if (end < 0) throw new InvalidOperationException("Couldn't read YouTube's results.");
        using var doc = JsonDocument.Parse(html.AsMemory(start, end - start));

        var videos = new List<Video>();
        Collect(doc.RootElement, videos);
        return videos.GroupBy(v => v.Id).Select(g => g.First()).Take(24).ToList();
    }

    static void Collect(JsonElement e, List<Video> into)
    {
        if (e.ValueKind == JsonValueKind.Object)
        {
            foreach (var p in e.EnumerateObject())
            {
                if (p.NameEquals("videoRenderer") && p.Value.ValueKind == JsonValueKind.Object)
                {
                    var v = Read(p.Value);
                    if (v != null) into.Add(v);
                }
                else Collect(p.Value, into);
            }
        }
        else if (e.ValueKind == JsonValueKind.Array)
        {
            foreach (var x in e.EnumerateArray()) Collect(x, into);
        }
    }

    static Video? Read(JsonElement r)
    {
        if (!r.TryGetProperty("videoId", out var id) || id.ValueKind != JsonValueKind.String) return null;
        return new Video(
            id.GetString()!,
            Text(r, "title") ?? "(untitled)",
            Text(r, "ownerText") ?? Text(r, "longBylineText"),
            Text(r, "lengthText"),
            Text(r, "shortViewCountText") ?? Text(r, "viewCountText"),
            Text(r, "publishedTimeText"));
    }

    /// <summary>YouTube text is either { simpleText } or { runs: [{ text }] }.</summary>
    static string? Text(JsonElement r, string name)
    {
        if (!r.TryGetProperty(name, out var t) || t.ValueKind != JsonValueKind.Object) return null;
        if (t.TryGetProperty("simpleText", out var s) && s.ValueKind == JsonValueKind.String) return s.GetString();
        if (t.TryGetProperty("runs", out var runs) && runs.ValueKind == JsonValueKind.Array)
            return string.Concat(runs.EnumerateArray().Select(x => x.TryGetProperty("text", out var tx) ? tx.GetString() : ""));
        return null;
    }
}

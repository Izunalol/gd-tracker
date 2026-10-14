using System.Net;
using System.Text.RegularExpressions;

namespace GDTracker;

/// <summary>
/// Downloads dragged/pasted image URLs for custom thumbnails (the page itself can't,
/// because of CORS).
/// </summary>
public static class WebFetch
{
    const int MaxImageBytes = 30 * 1024 * 1024;
    const string UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0";

    static readonly HttpClient Http = new(new SocketsHttpHandler
    {
        AutomaticDecompression = DecompressionMethods.All,
        AllowAutoRedirect = true,
        MaxAutomaticRedirections = 8,
        ConnectTimeout = TimeSpan.FromSeconds(15),
    }) { Timeout = TimeSpan.FromSeconds(40) };


    static Uri Check(string url)
    {
        if (!Uri.TryCreate(url.Trim(), UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https"))
            throw new InvalidOperationException("That doesn't look like a web link.");
        return u;
    }

    static async Task<(byte[] Bytes, string? ContentType, Uri FinalUrl)> Get(Uri url, string accept, int limit)
    {
        using var req = new HttpRequestMessage(HttpMethod.Get, url);
        req.Headers.TryAddWithoutValidation("User-Agent", UserAgent);
        req.Headers.TryAddWithoutValidation("Accept", accept);
        req.Headers.TryAddWithoutValidation("Accept-Language", "en-GB,en;q=0.9,ja;q=0.6");
        // Many image CDNs refuse hotlinks without a same-site referer.
        req.Headers.Referrer = new Uri(url.GetLeftPart(UriPartial.Authority) + "/");
        using var res = await Http.SendAsync(req, HttpCompletionOption.ResponseHeadersRead);
        if (!res.IsSuccessStatusCode)
            throw new InvalidOperationException((int)res.StatusCode is 401 or 403 or 429 or 503
                ? $"{url.Host} blocked the download ({(int)res.StatusCode}). Save the image from your browser and drop the file in instead."
                : $"The site answered {(int)res.StatusCode} {res.ReasonPhrase}.");
        if (res.Content.Headers.ContentLength > limit) throw new InvalidOperationException("That file is too large.");
        await using var s = await res.Content.ReadAsStreamAsync();
        using var ms = new MemoryStream();
        var buf = new byte[81920];
        int n;
        while ((n = await s.ReadAsync(buf)) > 0)
        {
            ms.Write(buf, 0, n);
            if (ms.Length > limit) throw new InvalidOperationException("That file is too large.");
        }
        return (ms.ToArray(), res.Content.Headers.ContentType?.MediaType, res.RequestMessage?.RequestUri ?? url);
    }

    static string? Sniff(byte[] b)
    {
        bool At(int o, params byte[] sig) => b.Length >= o + sig.Length && sig.Select((x, i) => b[o + i] == x).All(x => x);
        if (At(0, 0x89, 0x50, 0x4E, 0x47)) return "image/png";
        if (At(0, 0xFF, 0xD8, 0xFF)) return "image/jpeg";
        if (At(0, 0x47, 0x49, 0x46, 0x38)) return "image/gif";
        if (At(0, 0x52, 0x49, 0x46, 0x46) && At(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
        if (At(0, 0x42, 0x4D)) return "image/bmp";
        if (At(4, 0x66, 0x74, 0x79, 0x70) && b.Length > 12)
        {
            var brand = System.Text.Encoding.ASCII.GetString(b, 8, 4);
            if (brand is "avif" or "avis") return "image/avif";
        }
        if (At(0, 0x00, 0x00, 0x01, 0x00)) return "image/x-icon";
        var head = System.Text.Encoding.UTF8.GetString(b, 0, Math.Min(b.Length, 1024)).TrimStart('﻿', ' ', '\r', '\n', '\t');
        if (head.StartsWith("<svg", StringComparison.OrdinalIgnoreCase) ||
            (head.StartsWith("<?xml", StringComparison.OrdinalIgnoreCase) && head.Contains("<svg", StringComparison.OrdinalIgnoreCase)))
            return "image/svg+xml";
        return null;
    }

    /// <summary>Plain GET returning the body as text (small JSON endpoints).</summary>
    public static async Task<string> FetchText(string url)
    {
        var (bytes, _, _) = await Get(Check(url), "application/json,*/*;q=0.8", 2 * 1024 * 1024);
        return System.Text.Encoding.UTF8.GetString(bytes);
    }

    /// <summary>Downloads an image. If the link turns out to be a web page, its preview image (og:image) is used instead.</summary>
    public static async Task<object> DownloadImage(string url)
    {
        var uri = Check(url);
        for (int hop = 0; hop < 2; hop++)
        {
            var (bytes, type, final) = await Get(uri, "image/avif,image/webp,image/apng,image/*,*/*;q=0.8", MaxImageBytes);
            var mime = Sniff(bytes);
            if (mime != null)
                return new { dataUrl = $"data:{mime};base64,{Convert.ToBase64String(bytes)}", mime, url = final.AbsoluteUri };
            if (type != null && !type.Contains("html")) break;
            var html = System.Text.Encoding.UTF8.GetString(bytes);
            var m = Regex.Match(html, @"<meta[^>]+(?:property|name)\s*=\s*[""'](?:og:image(?::secure_url)?|twitter:image)[""'][^>]*>", RegexOptions.IgnoreCase);
            var c = m.Success ? Regex.Match(m.Value, @"content\s*=\s*[""']([^""']+)", RegexOptions.IgnoreCase) : Match.Empty;
            if (!c.Success) throw new InvalidOperationException("That page doesn't have an image I can use.");
            uri = new Uri(final, WebUtility.HtmlDecode(c.Groups[1].Value));
        }
        throw new InvalidOperationException("That link isn't an image.");
    }
}

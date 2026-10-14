using System.IO.Compression;
using System.Text.Json;

namespace GDTracker;

/// <summary>
/// Custom thumbnails and backgrounds live as files next to the prefs (images/&lt;id&gt; + images/thumbs/&lt;id&gt;).
/// The UI does the decoding and resizing (WebView2 understands every web format); the host just stores bytes.
/// </summary>
public static class ImageStore
{
    static readonly HashSet<string> Allowed = new(StringComparer.OrdinalIgnoreCase) { ".webp", ".png", ".jpg", ".jpeg", ".gif" };

    public static string Save(string fullBase64, string? thumbBase64, string ext)
    {
        ext = "." + ext.TrimStart('.').ToLowerInvariant();
        if (!Allowed.Contains(ext)) throw new InvalidOperationException("Unsupported image type.");
        var id = Guid.NewGuid().ToString("N")[..16] + ext;
        File.WriteAllBytes(Path.Combine(AppPaths.Images, id), Convert.FromBase64String(fullBase64));
        if (!string.IsNullOrEmpty(thumbBase64))
            File.WriteAllBytes(Path.Combine(AppPaths.Thumbs, id), Convert.FromBase64String(thumbBase64));
        return id;
    }

    public static bool IsValidId(string id) =>
        id.Length is > 4 and < 64 && id.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 && !id.Contains("..");

    public static string PathOf(string id) =>
        IsValidId(id) ? Path.Combine(AppPaths.Images, id) : throw new InvalidOperationException("Bad image id.");

    /// <summary>
    /// Deletes images nothing references any more. Files younger than a week are kept so that an undo,
    /// or restoring a recent backup, still finds its pictures.
    /// </summary>
    public static int Collect(IEnumerable<string> referenced)
    {
        var keep = new HashSet<string>(referenced, StringComparer.OrdinalIgnoreCase);
        var cutoff = DateTime.Now.AddDays(-7);
        int removed = 0;
        foreach (var dir in new[] { AppPaths.Images, AppPaths.Thumbs })
        foreach (var f in Directory.GetFiles(dir))
        {
            if (keep.Contains(Path.GetFileName(f)) || File.GetLastWriteTime(f) > cutoff) continue;
            try { File.Delete(f); removed++; } catch { }
        }
        return removed;
    }

    /// <summary>Writes prefs.json plus every custom image into a single portable .zip.</summary>
    public static void ExportBackup(string zipPath, string prefsJson)
    {
        var tmp = zipPath + ".tmp";
        if (File.Exists(tmp)) File.Delete(tmp);
        using (var zip = ZipFile.Open(tmp, ZipArchiveMode.Create))
        {
            using (var w = new StreamWriter(zip.CreateEntry("prefs.json", CompressionLevel.Optimal).Open()))
                w.Write(prefsJson);
            foreach (var f in Directory.GetFiles(AppPaths.Images))
                zip.CreateEntryFromFile(f, "images/" + Path.GetFileName(f), CompressionLevel.NoCompression);
            foreach (var f in Directory.GetFiles(AppPaths.Thumbs))
                zip.CreateEntryFromFile(f, "images/thumbs/" + Path.GetFileName(f), CompressionLevel.NoCompression);
        }
        File.Move(tmp, zipPath, true);
    }

    /// <summary>Copies the backup's images in (never overwriting) and returns its prefs JSON.</summary>
    public static string ImportBackup(string zipPath)
    {
        using var zip = ZipFile.OpenRead(zipPath);
        var prefs = zip.GetEntry("prefs.json") ?? throw new InvalidOperationException("That file isn't a GD Tracker backup.");
        string json;
        using (var r = new StreamReader(prefs.Open())) json = r.ReadToEnd();
        using (JsonDocument.Parse(json)) { }
        foreach (var e in zip.Entries)
        {
            string? dest = null;
            if (e.FullName.StartsWith("images/thumbs/") && IsValidId(e.Name)) dest = Path.Combine(AppPaths.Thumbs, e.Name);
            else if (e.FullName.StartsWith("images/") && e.FullName.Count(c => c == '/') == 1 && IsValidId(e.Name)) dest = Path.Combine(AppPaths.Images, e.Name);
            if (dest != null && !File.Exists(dest)) e.ExtractToFile(dest);
        }
        return json;
    }
}

using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace GDTracker;

public static class AppPaths
{
    /// <summary>Data folder; GDTRACKER_DATA overrides it (handy for testing against scratch prefs).</summary>
    public static readonly string Root = Environment.GetEnvironmentVariable("GDTRACKER_DATA") is { Length: > 0 } custom
        ? custom
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GD Tracker");
    public static readonly string Prefs = Path.Combine(Root, "prefs.json");
    public static readonly string Images = Path.Combine(Root, "images");
    public static readonly string Thumbs = Path.Combine(Images, "thumbs");
    public static readonly string Cache = Path.Combine(Root, "cache");
    public static readonly string LevelThumbs = Path.Combine(Cache, "levelthumbs");
    public static readonly string LevelInfo = Path.Combine(Cache, "levelinfo.json");
    public static readonly string Backups = Path.Combine(Root, "backups");
    public static readonly string WebViewData = Path.Combine(Root, "WebView2");
    public static readonly string Window = Path.Combine(Root, "window.json");

    public static void Ensure()
    {
        foreach (var d in new[] { Root, Images, Thumbs, Cache, LevelThumbs, Backups }) Directory.CreateDirectory(d);
    }
}

public static class Json
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        PropertyNameCaseInsensitive = true,
    };

    public static readonly JsonSerializerOptions Compact = new(Options) { WriteIndented = false };

    public static T? Read<T>(string path) where T : class
    {
        try
        {
            if (!File.Exists(path)) return null;
            return JsonSerializer.Deserialize<T>(File.ReadAllText(path), Options);
        }
        catch { return null; }
    }

    public static void Write(string path, object value) => WriteText(path, JsonSerializer.Serialize(value, Options));

    /// <summary>Atomic write: temp file + replace, so a crash never leaves a half-written file.</summary>
    public static void WriteText(string path, string text)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, text);
        File.Move(tmp, path, true);
    }

    public static T Get<T>(JsonElement e, string name, T fallback)
    {
        if (e.ValueKind != JsonValueKind.Object || !e.TryGetProperty(name, out var p) || p.ValueKind == JsonValueKind.Null)
            return fallback;
        try { return p.Deserialize<T>(Options) ?? fallback; } catch { return fallback; }
    }
}

/// <summary>
/// The prefs document (settings + per-level customisation) is owned by the web UI; the host only
/// persists it atomically and keeps one rolling backup per day.
/// </summary>
public static class PrefsFile
{
    const int KeepBackups = 30;

    public static string? Load()
    {
        if (!File.Exists(AppPaths.Prefs)) return null;
        var text = File.ReadAllText(AppPaths.Prefs);
        try { using var _ = JsonDocument.Parse(text); }
        catch
        {
            // Corrupt file: keep it aside and fall back to the newest backup.
            File.Copy(AppPaths.Prefs, AppPaths.Prefs + $".corrupt-{DateTime.Now:yyyyMMdd-HHmmss}", true);
            var latest = Directory.GetFiles(AppPaths.Backups, "prefs-*.json").OrderDescending().FirstOrDefault();
            return latest != null ? File.ReadAllText(latest) : null;
        }
        DailyBackup();
        return text;
    }

    public static void Save(string json)
    {
        using (JsonDocument.Parse(json)) { } // never persist something we couldn't read back
        Json.WriteText(AppPaths.Prefs, json);
    }

    static void DailyBackup()
    {
        try
        {
            var target = Path.Combine(AppPaths.Backups, $"prefs-{DateTime.Now:yyyy-MM-dd}.json");
            if (!File.Exists(target)) File.Copy(AppPaths.Prefs, target);
            foreach (var old in Directory.GetFiles(AppPaths.Backups, "prefs-*.json").OrderDescending().Skip(KeepBackups))
                File.Delete(old);
        }
        catch { }
    }
}

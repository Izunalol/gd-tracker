using System.Text.Json;

namespace GDTracker;

/// <summary>
/// Reads the Death Tracker mod's save folder (read-only — we never write into it).
/// Layout per level: levels/&lt;levelKey&gt;/{metadata, general.dt, sessions/&lt;start&gt;.dt, backups/...}.
/// Every file is plain JSON; the UI does all the interpretation.
/// </summary>
public static class DeathTracker
{
    public const string ModId = "elohmrow.death_tracker";

    public static string GeodeModsDir => Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "GeometryDash", "geode", "mods");

    public static string ModDir => Path.Combine(GeodeModsDir, ModId);

    /// <summary>The folder the mod is saving to: its "save-path-new" setting if that exists, else the default.</summary>
    public static string DetectLevelsFolder()
    {
        try
        {
            var settings = Path.Combine(ModDir, "settings.json");
            if (File.Exists(settings))
            {
                using var doc = JsonDocument.Parse(File.ReadAllText(settings));
                if (doc.RootElement.TryGetProperty("save-path-new", out var p) && p.ValueKind == JsonValueKind.String
                    && p.GetString() is { Length: > 0 } custom && Directory.Exists(custom))
                    return custom;
            }
        }
        catch { }
        return Path.Combine(ModDir, "levels");
    }

    public static string Resolve(string? overridePath) =>
        !string.IsNullOrWhiteSpace(overridePath) ? overridePath.Trim() : DetectLevelsFolder();

    public record SessionFile(string File, JsonElement? Data);
    public record LevelFiles(string Key, JsonElement? Meta, JsonElement? General, List<SessionFile> Sessions, long Mtime, string? Error);

    public static object LoadAll(string folder)
    {
        if (!Directory.Exists(folder))
            return new { folder, exists = false, levels = Array.Empty<LevelFiles>() };
        var levels = Directory.GetDirectories(folder)
            .AsParallel()
            .Select(LoadLevel)
            .Where(l => l != null)
            .ToList();
        return new { folder, exists = true, levels };
    }

    public static object LoadSome(string folder, IEnumerable<string> keys)
    {
        var levels = keys.Distinct()
            .Where(k => k.Length > 0 && k.IndexOfAny(Path.GetInvalidFileNameChars()) < 0 && k != "..")
            .Select(k => new { key = k, dir = Path.Combine(folder, k) })
            .Select(x => Directory.Exists(x.dir) ? LoadLevel(x.dir) : null)
            .ToList();
        var removed = keys.Where(k => !Directory.Exists(Path.Combine(folder, k))).ToList();
        return new { levels = levels.Where(l => l != null), removed };
    }

    static LevelFiles? LoadLevel(string dir)
    {
        var key = Path.GetFileName(dir);
        var metaPath = Path.Combine(dir, "metadata");
        if (!File.Exists(metaPath)) return null;
        string? error = null;
        var meta = ReadJson(metaPath, ref error);
        var general = ReadJson(Path.Combine(dir, "general.dt"), ref error);
        var sessions = new List<SessionFile>();
        long mtime = ToUnix(File.GetLastWriteTimeUtc(metaPath));
        var generalPath = Path.Combine(dir, "general.dt");
        if (File.Exists(generalPath)) mtime = Math.Max(mtime, ToUnix(File.GetLastWriteTimeUtc(generalPath)));
        var sessDir = Path.Combine(dir, "sessions");
        if (Directory.Exists(sessDir))
        {
            foreach (var f in Directory.GetFiles(sessDir, "*.dt"))
            {
                var data = ReadJson(f, ref error);
                if (data != null) sessions.Add(new SessionFile(Path.GetFileNameWithoutExtension(f), data));
            }
        }
        return new LevelFiles(key, meta, general, sessions, mtime, error);
    }

    static long ToUnix(DateTime utc) => new DateTimeOffset(utc).ToUnixTimeSeconds();

    static JsonElement? ReadJson(string path, ref string? error)
    {
        if (!File.Exists(path)) return null;
        // The game may be mid-write; read shared and retry once.
        for (int attempt = 0; attempt < 2; attempt++)
        {
            try
            {
                using var fs = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
                using var sr = new StreamReader(fs);
                var text = sr.ReadToEnd();
                if (string.IsNullOrWhiteSpace(text)) return null;
                using var doc = JsonDocument.Parse(text);
                return doc.RootElement.Clone();
            }
            catch (Exception ex)
            {
                if (attempt == 1) error = $"{Path.GetFileName(path)}: {ex.Message}";
                else Thread.Sleep(60);
            }
        }
        return null;
    }
}

/// <summary>Watches the save folder and reports which level keys changed (debounced), so the UI can refresh live.</summary>
public sealed class DeathTrackerWatcher : IDisposable
{
    readonly Action<IReadOnlyCollection<string>, bool> _changed;
    FileSystemWatcher? _fsw;
    string? _folder;
    readonly HashSet<string> _pending = new(StringComparer.OrdinalIgnoreCase);
    bool _all;
    readonly System.Threading.Timer _timer;
    readonly object _lock = new();

    public DeathTrackerWatcher(Action<IReadOnlyCollection<string>, bool> changed)
    {
        _changed = changed;
        _timer = new System.Threading.Timer(_ => Flush(), null, Timeout.Infinite, Timeout.Infinite);
    }

    public void Watch(string folder)
    {
        if (string.Equals(folder, _folder, StringComparison.OrdinalIgnoreCase) && _fsw != null) return;
        _fsw?.Dispose();
        _fsw = null;
        _folder = folder;
        if (!Directory.Exists(folder)) return;
        _fsw = new FileSystemWatcher(folder)
        {
            IncludeSubdirectories = true,
            NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
            InternalBufferSize = 64 * 1024,
        };
        _fsw.Changed += OnEvent;
        _fsw.Created += OnEvent;
        _fsw.Deleted += OnEvent;
        _fsw.Renamed += (s, e) => { OnEvent(s, e); Note(e.OldFullPath); };
        _fsw.Error += (_, _) => { lock (_lock) { _all = true; } Kick(); };
        _fsw.EnableRaisingEvents = true;
    }

    void OnEvent(object sender, FileSystemEventArgs e) => Note(e.FullPath);

    void Note(string fullPath)
    {
        if (_folder == null) return;
        var rel = Path.GetRelativePath(_folder, fullPath);
        var parts = rel.Split(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
        if (parts.Length == 0 || parts[0] == "..") return;
        if (parts.Length > 1 && parts[1].Equals("backups", StringComparison.OrdinalIgnoreCase)) return;
        lock (_lock) _pending.Add(parts[0]);
        Kick();
    }

    void Kick() => _timer.Change(1200, Timeout.Infinite);

    void Flush()
    {
        string[] keys;
        bool all;
        lock (_lock)
        {
            keys = _pending.ToArray();
            all = _all;
            _pending.Clear();
            _all = false;
        }
        if (keys.Length > 0 || all) _changed(keys, all);
    }

    public void Dispose()
    {
        _timer.Dispose();
        _fsw?.Dispose();
    }
}

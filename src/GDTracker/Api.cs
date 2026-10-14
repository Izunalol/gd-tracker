using System.Text.Json;

namespace GDTracker;

/// <summary>JSON-RPC surface used by the web UI. Every UI action that needs the OS lands here.</summary>
public sealed class Api
{
    readonly MainForm _form;
    readonly DeathTrackerWatcher _watcher;
    string _folder = DeathTracker.DetectLevelsFolder();

    public Api(MainForm form)
    {
        _form = form;
        _watcher = new DeathTrackerWatcher((keys, all) => _form.Emit("dt.changed", new { keys, all }));
    }

    public async Task<object?> Handle(string method, JsonElement p)
    {
        switch (method)
        {
            // ---------- app ----------
            case "app.init":
                return new
                {
                    version = Application.ProductVersion.Split('+')[0],
                    dataFolder = AppPaths.Root,
                    systemDark = Native.SystemUsesDarkTheme(),
                    detectedFolder = DeathTracker.DetectLevelsFolder(),
                    modInstalled = Directory.Exists(DeathTracker.ModDir),
                    prefs = PrefsFile.Load(),
                };
            case "app.titleBar":
                _form.StyleTitleBar(Json.Get(p, "dark", false), Json.Get(p, "color", "#ffffff"));
                return null;
            case "app.openUrl":
                Native.OpenUrl(Json.Get(p, "url", ""));
                return null;
            case "app.openDataFolder":
                Native.OpenFolder(AppPaths.Root);
                return null;
            case "prefs.save":
                PrefsFile.Save(Json.Get(p, "json", ""));
                return true;

            // ---------- death tracker data ----------
            case "dt.load":
            {
                _folder = DeathTracker.Resolve(Json.Get<string?>(p, "path", null));
                var folder = _folder;
                var data = await Task.Run(() => DeathTracker.LoadAll(folder));
                _watcher.Watch(folder);
                return data;
            }
            case "dt.loadLevels":
            {
                var keys = Json.Get(p, "keys", new List<string>());
                var folder = _folder;
                return await Task.Run(() => DeathTracker.LoadSome(folder, keys));
            }
            case "dt.openFolder":
                Native.OpenFolder(Directory.Exists(_folder) ? _folder : DeathTracker.GeodeModsDir);
                return null;
            case "dt.pickFolder":
            {
                using var dlg = new FolderBrowserDialog
                {
                    Description = "Choose the Death Tracker \"levels\" folder",
                    UseDescriptionForTitle = true,
                    InitialDirectory = Directory.Exists(_folder) ? _folder : DeathTracker.GeodeModsDir,
                };
                return dlg.ShowDialog(_form) == DialogResult.OK ? dlg.SelectedPath : null;
            }

            // ---------- online extras ----------
            case "online.cached":
                return GdOnline.Cached();
            case "online.info":
            {
                var ids = Json.Get(p, "ids", new List<long>());
                return await GdOnline.Fetch(ids, Json.Get(p, "force", false));
            }
            case "thumbs.cached":
                return GdOnline.CachedThumbs(Json.Get(p, "ids", new List<long>()), Json.Get(p, "hd", false));
            case "thumbs.fetch":
            {
                long id = Json.Get(p, "id", 0L);
                bool hd = Json.Get(p, "hd", false);
                return await Task.Run(() => GdOnline.Thumb(id, hd));
            }
            case "online.search":
                return await GdOnline.SearchText(Json.Get(p, "query", ""), Json.Get(p, "page", 0));
            case "gd.icons":
                return await Task.Run(GdIcons.Ensure);
            case "web.oembed":
            {
                // Video title/channel for a pasted YouTube link (the page can't fetch it itself: CORS).
                var url = Json.Get(p, "url", "");
                if (!Uri.TryCreate(url, UriKind.Absolute, out var u) || !(u.Host.EndsWith("youtube.com") || u.Host == "youtu.be")) return null;
                try
                {
                    var text = await WebFetch.FetchText("https://www.youtube.com/oembed?format=json&url=" + Uri.EscapeDataString(url));
                    using var doc = JsonDocument.Parse(text);
                    return new { title = doc.RootElement.GetProperty("title").GetString(), author = doc.RootElement.TryGetProperty("author_name", out var a) ? a.GetString() : null };
                }
                catch { return null; }
            }
            case "lists.get":
                return await DemonLists.Get(Json.Get(p, "name", ""), Json.Get(p, "force", false), Json.Get(p, "online", true));
            case "thumbs.clearCache":
                GdOnline.ClearThumbCache();
                return true;

            // ---------- images ----------
            case "images.save":
                return ImageStore.Save(Json.Get(p, "full", ""), Json.Get<string?>(p, "thumb", null), Json.Get(p, "ext", "webp"));
            case "images.download":
            {
                var url = Json.Get(p, "url", "");
                return await Task.Run(() => WebFetch.DownloadImage(url));
            }
            case "images.collect":
            {
                var ids = Json.Get(p, "keep", new List<string>());
                return await Task.Run(() => ImageStore.Collect(ids));
            }

            // ---------- files ----------
            case "file.saveText":
            {
                using var dlg = new SaveFileDialog
                {
                    FileName = SafeName(Json.Get(p, "name", "export")),
                    Filter = Json.Get(p, "filter", "All files (*.*)|*.*"),
                };
                if (dlg.ShowDialog(_form) != DialogResult.OK) return null;
                var content = Json.Get(p, "content", "");
                // Excel only detects UTF-8 CSVs that carry a BOM.
                await File.WriteAllTextAsync(dlg.FileName, content, new System.Text.UTF8Encoding(Json.Get(p, "bom", false)));
                return dlg.FileName;
            }
            case "backup.export":
            {
                using var dlg = new SaveFileDialog
                {
                    FileName = $"GD Tracker Backup {DateTime.Now:yyyy-MM-dd}.zip",
                    Filter = "GD Tracker backup (*.zip)|*.zip",
                };
                if (dlg.ShowDialog(_form) != DialogResult.OK) return null;
                var json = Json.Get(p, "json", "");
                var path = dlg.FileName;
                await Task.Run(() => ImageStore.ExportBackup(path, json));
                return path;
            }
            case "backup.import":
            {
                using var dlg = new OpenFileDialog { Filter = "GD Tracker backup (*.zip)|*.zip" };
                if (dlg.ShowDialog(_form) != DialogResult.OK) return null;
                var path = dlg.FileName;
                return await Task.Run(() => ImageStore.ImportBackup(path));
            }
        }
        throw new InvalidOperationException($"Unknown method {method}");
    }

    static string SafeName(string s)
    {
        foreach (var c in Path.GetInvalidFileNameChars()) s = s.Replace(c, ' ');
        return s.Trim().Length > 0 ? s.Trim() : "export";
    }
}

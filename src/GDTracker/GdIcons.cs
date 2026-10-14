using System.Drawing;
using System.Drawing.Imaging;
using System.Text.RegularExpressions;
using System.Xml.Linq;

namespace GDTracker;

/// <summary>
/// Difficulty faces cut out of the user's own Geometry Dash install (GJ_GameSheet03), cached as PNGs in
/// cache/gdicons. Nothing from the game ships with the app; without GD installed the UI falls back to text.
/// </summary>
public static class GdIcons
{
    static readonly string Dir = Path.Combine(AppPaths.Cache, "gdicons", "v3"); // bump when the cut-out changes

    // Same numbering as the mod's difficulty values (-1 auto, 0 N/A, 1-5, 6 hard demon, 7 easy … 10 extreme).
    static readonly Dictionary<string, string> Sprites = new()
    {
        ["auto"] = "difficulty_auto_btn_001.png",
        ["0"] = "difficulty_00_btn_001.png", ["1"] = "difficulty_01_btn_001.png", ["2"] = "difficulty_02_btn_001.png",
        ["3"] = "difficulty_03_btn_001.png", ["4"] = "difficulty_04_btn_001.png", ["5"] = "difficulty_05_btn_001.png",
        ["6"] = "difficulty_06_btn_001.png", ["7"] = "difficulty_07_btn_001.png", ["8"] = "difficulty_08_btn_001.png",
        ["9"] = "difficulty_09_btn_001.png", ["10"] = "difficulty_10_btn_001.png",
    };

    /// <summary>Returns { available, icons: { "10": "cache/gdicons/10.png", … } }, extracting on first use.</summary>
    public static object Ensure()
    {
        Directory.CreateDirectory(Dir);
        var have = Sprites.Keys.Where(k => File.Exists(Path.Combine(Dir, k + ".png"))).ToList();
        if (have.Count < Sprites.Count)
        {
            try { Extract(); } catch { /* GD not installed or sheet changed: text fallback */ }
            have = Sprites.Keys.Where(k => File.Exists(Path.Combine(Dir, k + ".png"))).ToList();
        }
        return new { available = have.Count == Sprites.Count, icons = have.ToDictionary(k => k, k => $"cache/gdicons/v3/{k}.png") };
    }

    static void Extract()
    {
        var res = FindResources() ?? throw new InvalidOperationException("Geometry Dash not found.");
        var plist = Path.Combine(res, "GJ_GameSheet03-uhd.plist");
        var png = Path.Combine(res, "GJ_GameSheet03-uhd.png");
        if (!File.Exists(plist)) { plist = Path.Combine(res, "GJ_GameSheet03-hd.plist"); png = Path.Combine(res, "GJ_GameSheet03-hd.png"); }
        var frames = ReadFrames(plist);
        using var sheet = new Bitmap(png);
        foreach (var (key, sprite) in Sprites)
        {
            if (!frames.TryGetValue(sprite, out var f)) continue;
            // Rotated frames are stored turned 90° clockwise, with width/height swapped.
            var src = f.Rotated ? new Rectangle(f.Rect.X, f.Rect.Y, f.Rect.Height, f.Rect.Width) : f.Rect;
            using var bmp = sheet.Clone(src, PixelFormat.Format32bppArgb);
            if (f.Rotated) bmp.RotateFlip(RotateFlipType.Rotate270FlipNone);
            using var face = TrimLabel(bmp);
            face.Save(Path.Combine(Dir, key + ".png"), ImageFormat.Png);
        }
    }

    /// <summary>
    /// The button sprites carry a text label ("Insane", "Demon") under the face. Walking up from the bottom,
    /// skip the label, then cut at the first fully transparent row between it and the face.
    /// </summary>
    static Bitmap TrimLabel(Bitmap bmp)
    {
        bool Empty(int y)
        {
            for (int x = 0; x < bmp.Width; x++) if (bmp.GetPixel(x, y).A > 24) return false;
            return true;
        }
        int yy = bmp.Height - 1;
        while (yy > 0 && Empty(yy)) yy--;            // bottom padding
        while (yy > 0 && !Empty(yy)) yy--;           // the label
        int gapBottom = yy;
        while (yy > 0 && Empty(yy)) yy--;            // the gap
        // Only trust it if the face is a sensible share of the sprite.
        int h = yy < bmp.Height * 0.5 || gapBottom >= bmp.Height - 2 ? bmp.Height : yy + 1;
        // The label is usually wider than the face: trim the side padding it leaves.
        int minX = bmp.Width, maxX = -1, minY = h, maxY = -1;
        for (int y = 0; y < h; y++)
            for (int x = 0; x < bmp.Width; x++)
                if (bmp.GetPixel(x, y).A > 24) { minX = Math.Min(minX, x); maxX = Math.Max(maxX, x); minY = Math.Min(minY, y); maxY = Math.Max(maxY, y); }
        if (maxX < 0) return new Bitmap(bmp);
        return bmp.Clone(Rectangle.FromLTRB(minX, minY, maxX + 1, maxY + 1), PixelFormat.Format32bppArgb);
    }

    record Frame(Rectangle Rect, bool Rotated);

    static Dictionary<string, Frame> ReadFrames(string plistPath)
    {
        var doc = XDocument.Load(plistPath);
        var root = doc.Root!.Element("dict")!;
        var framesDict = Pairs(root).First(p => p.Key == "frames").Value;
        var result = new Dictionary<string, Frame>();
        foreach (var (name, dict) in Pairs(framesDict))
        {
            var props = Pairs(dict).ToDictionary(p => p.Key, p => p.Value);
            if (!props.TryGetValue("textureRect", out var rectEl)) continue;
            var n = Regex.Matches(rectEl.Value, @"-?\d+").Select(m => int.Parse(m.Value)).ToArray();
            if (n.Length < 4) continue;
            bool rotated = props.TryGetValue("textureRotated", out var r) && r.Name.LocalName == "true";
            result[name] = new Frame(new Rectangle(n[0], n[1], n[2], n[3]), rotated);
        }
        return result;
    }

    /// <summary>A plist dict is a flat list of key, value, key, value… elements.</summary>
    static IEnumerable<(string Key, XElement Value)> Pairs(XElement dict)
    {
        var els = dict.Elements().ToList();
        for (int i = 0; i + 1 < els.Count; i += 2)
            if (els[i].Name.LocalName == "key") yield return (els[i].Value, els[i + 1]);
    }

    /// <summary>GD's Resources folder: the default Steam path, then every Steam library listed in libraryfolders.vdf.</summary>
    static string? FindResources()
    {
        var candidates = new List<string> { @"C:\Program Files (x86)\Steam\steamapps\common\Geometry Dash" };
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Valve\Steam");
            if (key?.GetValue("SteamPath") is string steam)
            {
                steam = steam.Replace('/', '\\');
                candidates.Add(Path.Combine(steam, "steamapps", "common", "Geometry Dash"));
                var vdf = Path.Combine(steam, "steamapps", "libraryfolders.vdf");
                if (File.Exists(vdf))
                    foreach (Match m in Regex.Matches(File.ReadAllText(vdf), "\"path\"\\s*\"([^\"]+)\""))
                        candidates.Add(Path.Combine(m.Groups[1].Value.Replace(@"\\", @"\"), "steamapps", "common", "Geometry Dash"));
            }
        }
        catch { }
        return candidates.Select(c => Path.Combine(c, "Resources")).FirstOrDefault(r => File.Exists(Path.Combine(r, "GJ_GameSheet03-uhd.plist")) || File.Exists(Path.Combine(r, "GJ_GameSheet03-hd.plist")));
    }
}

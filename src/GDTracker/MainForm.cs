using System.Reflection;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace GDTracker;

public sealed class MainForm : Form
{
    const string AppHost = "app.gdtracker";
    const string ImageHost = "data.gdtracker";
    readonly WebView2 _web;
    readonly Api _api;
    bool _ready;
    readonly Queue<string> _pending = new();
    readonly bool _dark = Native.SystemUsesDarkTheme();

    record WindowPlacement(int X, int Y, int W, int H, bool Max);

    public MainForm()
    {
        var bg = _dark ? Color.FromArgb(30, 30, 30) : Color.White;
        _web = new WebView2 { Dock = DockStyle.Fill, DefaultBackgroundColor = bg };
        Text = "GD Tracker";
        BackColor = bg;
        MinimumSize = new Size(900, 600);
        StartPosition = FormStartPosition.CenterScreen;
        Size = new Size(1360, 880);
        try { Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath); } catch { }
        RestorePlacement();
        Controls.Add(_web);
        _api = new Api(this);
        Load += async (_, _) => await InitAsync();
        FormClosing += (_, _) => SavePlacement();
    }

    protected override void OnHandleCreated(EventArgs e)
    {
        base.OnHandleCreated(e);
        Native.StyleTitleBar(Handle, _dark, BackColor);
    }

    async Task InitAsync()
    {
        try
        {
            var env = await CoreWebView2Environment.CreateAsync(null, AppPaths.WebViewData);
            await _web.EnsureCoreWebView2Async(env);
        }
        catch (WebView2RuntimeNotFoundException)
        {
            if (MessageBox.Show(this, "GD Tracker needs the Microsoft Edge WebView2 Runtime (it ships with Windows 11).\n\nOpen the download page?",
                    "WebView2 required", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) == DialogResult.Yes)
                Native.OpenUrl("https://developer.microsoft.com/microsoft-edge/webview2/");
            Close();
            return;
        }

        var core = _web.CoreWebView2;
        var dev = Environment.GetEnvironmentVariable("GDTRACKER_DEV") == "1";
        core.Settings.AreDevToolsEnabled = dev;
        core.Settings.AreDefaultContextMenusEnabled = true; // the UI suppresses it except in text fields
        core.Settings.AreBrowserAcceleratorKeysEnabled = dev;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.Settings.IsPasswordAutosaveEnabled = false;
        core.Settings.IsGeneralAutofillEnabled = false;

        var uiDir = Environment.GetEnvironmentVariable("GDTRACKER_UI_DIR");
        if (!string.IsNullOrEmpty(uiDir) && Directory.Exists(uiDir))
            core.SetVirtualHostNameToFolderMapping(AppHost, uiDir, CoreWebView2HostResourceAccessKind.Allow);
        else
        {
            core.AddWebResourceRequestedFilter($"https://{AppHost}/*", CoreWebView2WebResourceContext.All);
            core.WebResourceRequested += ServeEmbedded;
        }
        core.SetVirtualHostNameToFolderMapping(ImageHost, AppPaths.Root, CoreWebView2HostResourceAccessKind.Allow);

        // "Paste image" reads the clipboard; that's our own UI, so no prompt.
        core.PermissionRequested += (_, e) =>
        {
            if (e.PermissionKind == CoreWebView2PermissionKind.ClipboardRead) e.State = CoreWebView2PermissionState.Allow;
        };
        core.WebMessageReceived += OnMessage;
        core.NewWindowRequested += (_, e) => { e.Handled = true; Native.OpenUrl(e.Uri); };
        core.NavigationStarting += (_, e) =>
        {
            // Dropping a link or file that the page didn't handle would otherwise navigate away from the app.
            if (!e.Uri.StartsWith($"https://{AppHost}/")) { e.Cancel = true; Native.OpenUrl(e.Uri); }
        };
        core.NavigationCompleted += (_, _) =>
        {
            _ready = true;
            while (_pending.Count > 0) core.PostWebMessageAsJson(_pending.Dequeue());
        };
        core.Navigate($"https://{AppHost}/index.html");
    }

    static readonly Dictionary<string, string> Mime = new(StringComparer.OrdinalIgnoreCase)
    {
        [".html"] = "text/html; charset=utf-8", [".js"] = "text/javascript; charset=utf-8", [".css"] = "text/css; charset=utf-8",
        [".svg"] = "image/svg+xml", [".png"] = "image/png", [".json"] = "application/json", [".woff2"] = "font/woff2",
        [".ico"] = "image/x-icon",
    };

    // MSBuild names nested embedded files with backslashes ("wwwroot/js\views\grid.js"); index them by URL path.
    static readonly Dictionary<string, string> Embedded = Assembly.GetExecutingAssembly().GetManifestResourceNames()
        .Where(n => n.StartsWith("wwwroot", StringComparison.Ordinal))
        .ToDictionary(n => n.Replace('\\', '/')["wwwroot/".Length..], n => n, StringComparer.OrdinalIgnoreCase);

    void ServeEmbedded(object? sender, CoreWebView2WebResourceRequestedEventArgs e)
    {
        var path = Uri.UnescapeDataString(new Uri(e.Request.Uri).AbsolutePath.TrimStart('/'));
        if (path.Length == 0) path = "index.html";
        var stream = Embedded.TryGetValue(path, out var res) ? Assembly.GetExecutingAssembly().GetManifestResourceStream(res) : null;
        var env = _web.CoreWebView2.Environment;
        if (stream == null) { e.Response = env.CreateWebResourceResponse(null, 404, "Not Found", ""); return; }
        var type = Mime.GetValueOrDefault(Path.GetExtension(path), "application/octet-stream");
        e.Response = env.CreateWebResourceResponse(stream, 200, "OK", $"Content-Type: {type}\r\nCache-Control: no-cache");
    }

    async void OnMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        int id = 0;
        try
        {
            using var doc = JsonDocument.Parse(e.WebMessageAsJson);
            var root = doc.RootElement;
            id = root.GetProperty("id").GetInt32();
            var method = root.GetProperty("method").GetString()!;
            var p = root.TryGetProperty("params", out var pp) ? pp.Clone() : default;
            var result = await _api.Handle(method, p);
            Post(JsonSerializer.Serialize(new { id, result }, Json.Compact));
        }
        catch (Exception ex)
        {
            var inner = ex is AggregateException ae ? ae.InnerException ?? ex : ex;
            var msg = inner is TaskCanceledException ? "The server took too long to respond." :
                      inner is HttpRequestException hre ? $"Couldn't reach the server ({hre.Message})" : inner.Message;
            Post(JsonSerializer.Serialize(new { id, error = msg }, Json.Compact));
        }
    }

    /// <summary>Pushes an unsolicited event to the UI (rpc.js `on(event, fn)`). Safe from any thread.</summary>
    public void Emit(string evt, object? data) => Post(JsonSerializer.Serialize(new { @event = evt, data }, Json.Compact));

    void Post(string json)
    {
        if (InvokeRequired) { BeginInvoke(() => Post(json)); return; }
        if (!_ready || _web.CoreWebView2 == null) { _pending.Enqueue(json); return; }
        _web.CoreWebView2.PostWebMessageAsJson(json);
    }

    /// <summary>Matches the native title bar to the UI theme.</summary>
    public void StyleTitleBar(bool dark, string hex)
    {
        Color c;
        try { c = ColorTranslator.FromHtml(hex); } catch { c = dark ? Color.FromArgb(30, 30, 30) : Color.White; }
        BackColor = c;
        _web.DefaultBackgroundColor = c;
        Native.StyleTitleBar(Handle, dark, c);
    }

    public void BringToFrontForced()
    {
        if (InvokeRequired) { BeginInvoke(BringToFrontForced); return; }
        if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
        Native.ForceForeground(Handle);
        _web.Focus();
    }

    void RestorePlacement()
    {
        var p = Json.Read<WindowPlacement>(AppPaths.Window);
        if (p == null) return;
        var rect = new Rectangle(p.X, p.Y, p.W, p.H);
        if (!Screen.AllScreens.Any(s => s.WorkingArea.IntersectsWith(rect))) return;
        StartPosition = FormStartPosition.Manual;
        Bounds = rect;
        if (p.Max) WindowState = FormWindowState.Maximized;
    }

    void SavePlacement()
    {
        try
        {
            var b = WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
            Json.Write(AppPaths.Window, new WindowPlacement(b.X, b.Y, b.Width, b.Height, WindowState == FormWindowState.Maximized));
        }
        catch { }
    }
}

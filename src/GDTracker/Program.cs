namespace GDTracker;

static class Program
{
    // One instance per data folder, so a test copy with GDTRACKER_DATA can run next to the real one.
    static readonly string Suffix = Convert.ToHexString(
        System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(AppPaths.Root.ToLowerInvariant())))[..12];
    static readonly string MutexName = "GDTracker.SingleInstance." + Suffix;
    static readonly string ShowEventName = "GDTracker.Show." + Suffix;

    [STAThread]
    static void Main()
    {
        using var mutex = new Mutex(true, MutexName, out bool first);
        if (!first)
        {
            // Already running: ask the existing window to come forward.
            try { using var ev = EventWaitHandle.OpenExisting(ShowEventName); ev.Set(); } catch { }
            return;
        }

        AppPaths.Ensure();
        ApplicationConfiguration.Initialize();
        var form = new MainForm();

        using var showEvent = new EventWaitHandle(false, EventResetMode.AutoReset, ShowEventName);
        var listener = new Thread(() =>
        {
            while (showEvent.WaitOne())
            {
                if (form.IsDisposed) break;
                try { form.BeginInvoke(form.BringToFrontForced); } catch { break; }
            }
        }) { IsBackground = true };
        listener.Start();

        Application.Run(form);
    }
}

# Clickyy Windows bridge.
# Reads one JSON request per line on stdin: {"id": n, "op": "<allowlisted op>", "args": {...}}
# Writes one JSON response per line on stdout: {"id": n, "ok": true, "result": ...} | {"id": n, "ok": false, "error": "..."}
# Only the operations in the switch below exist. There is no generic command execution.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Windows.Forms

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

namespace ClickyyBridge {
  [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioEndpointVolume {
    int RegisterControlChangeNotify(IntPtr p);
    int UnregisterControlChangeNotify(IntPtr p);
    int GetChannelCount(out uint c);
    int SetMasterVolumeLevel(float l, ref Guid ctx);
    int SetMasterVolumeLevelScalar(float l, ref Guid ctx);
    int GetMasterVolumeLevel(out float l);
    int GetMasterVolumeLevelScalar(out float l);
    int SetChannelVolumeLevel(uint ch, float l, ref Guid ctx);
    int SetChannelVolumeLevelScalar(uint ch, float l, ref Guid ctx);
    int GetChannelVolumeLevel(uint ch, out float l);
    int GetChannelVolumeLevelScalar(uint ch, out float l);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid ctx);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
  }

  [StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid fmtid; public int pid; }
  [StructLayout(LayoutKind.Explicit)] public struct PropVariant { [FieldOffset(0)] public short vt; [FieldOffset(8)] public IntPtr p; }

  [ComImport, Guid("886d8eeb-8cf2-4446-8d02-cdba1dbdcf99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IPropertyStore {
    int GetCount(out int c);
    int GetAt(int i, out PropertyKey k);
    int GetValue(ref PropertyKey k, out PropVariant v);
  }

  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDevice {
    int Activate(ref Guid id, int ctx, IntPtr p, [MarshalAs(UnmanagedType.IUnknown)] out object o);
    int OpenPropertyStore(int access, out IPropertyStore ps);
  }

  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IMMDeviceEnumerator {
    int EnumAudioEndpoints(int flow, int mask, out IntPtr devs);
    int GetDefaultAudioEndpoint(int flow, int role, out IMMDevice ep);
  }

  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MMDeviceEnumeratorCom { }

  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionEnumerator {
    int GetCount(out int c);
    int GetSession(int i, [MarshalAs(UnmanagedType.IUnknown)] out object s);
  }

  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionManager2 {
    int GetAudioSessionControl(IntPtr sessionGuid, int flags, out IntPtr ctl);
    int GetSimpleAudioVolume(IntPtr sessionGuid, int flags, out IntPtr vol);
    int GetSessionEnumerator(out IAudioSessionEnumerator e);
  }

  [ComImport, Guid("bfb7ff88-7239-4fc9-8fa2-07c950be9c6d"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IAudioSessionControl2 {
    int GetState(out int s);
    int GetDisplayName(out IntPtr n);
    int SetDisplayName(IntPtr n, ref Guid g);
    int GetIconPath(out IntPtr p);
    int SetIconPath(IntPtr p, ref Guid g);
    int GetGroupingParam(out Guid g);
    int SetGroupingParam(ref Guid g, ref Guid ctx);
    int RegisterAudioSessionNotification(IntPtr n);
    int UnregisterAudioSessionNotification(IntPtr n);
    int GetSessionIdentifier(out IntPtr s);
    int GetSessionInstanceIdentifier(out IntPtr s);
    int GetProcessId(out uint pid);
  }

  [ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ISimpleAudioVolume {
    int SetMasterVolume(float l, ref Guid g);
    int GetMasterVolume(out float l);
    int SetMute([MarshalAs(UnmanagedType.Bool)] bool m, ref Guid g);
    int GetMute([MarshalAs(UnmanagedType.Bool)] out bool m);
  }

  public static class Audio {
    static IMMDevice Device(int flow) {
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDevice dev;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(flow, 1, out dev));
      return dev;
    }
    static IAudioEndpointVolume Endpoint(int flow = 0) {
      var iid = typeof(IAudioEndpointVolume).GUID;
      object o;
      Marshal.ThrowExceptionForHR(Device(flow).Activate(ref iid, 23, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }
    public static int GetVolume() { float l; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out l)); return (int)Math.Round(l * 100); }
    public static void SetVolume(int pct) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, ref g)); }
    public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
    public static void SetMute(bool m) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMute(m, ref g)); }
    public static int GetMicVolume() { float l; Marshal.ThrowExceptionForHR(Endpoint(1).GetMasterVolumeLevelScalar(out l)); return (int)Math.Round(l * 100); }
    public static void SetMicVolume(int pct) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint(1).SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, ref g)); }
    public static bool GetMicMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint(1).GetMute(out m)); return m; }
    /** Mutes or unmutes the audio sessions that belong to the given process ids. Returns how many sessions changed. */
    public static int SetAppMute(int[] pids, bool mute) {
      var iid = typeof(IAudioSessionManager2).GUID;
      object o;
      Marshal.ThrowExceptionForHR(Device(0).Activate(ref iid, 23, IntPtr.Zero, out o));
      IAudioSessionEnumerator en;
      Marshal.ThrowExceptionForHR(((IAudioSessionManager2)o).GetSessionEnumerator(out en));
      int n; en.GetCount(out n);
      var set = new HashSet<int>(pids);
      int hits = 0;
      for (int i = 0; i < n; i++) {
        object s;
        if (en.GetSession(i, out s) != 0 || s == null) continue;
        var c2 = s as IAudioSessionControl2;
        if (c2 == null) continue;
        uint pid; c2.GetProcessId(out pid);
        if (!set.Contains((int)pid)) continue;
        var vol = s as ISimpleAudioVolume;
        if (vol == null) continue;
        var g = Guid.Empty;
        if (vol.SetMute(mute, ref g) == 0) hits++;
      }
      return hits;
    }
    [DllImport("ole32.dll")] static extern int PropVariantClear(ref PropVariant pv);
    public static string DeviceName(int flow) {
      try {
        IPropertyStore ps;
        Marshal.ThrowExceptionForHR(Device(flow).OpenPropertyStore(0, out ps));
        var key = new PropertyKey { fmtid = new Guid("a45c254e-df1c-4efd-8020-67d146a850e0"), pid = 14 };
        PropVariant v;
        Marshal.ThrowExceptionForHR(ps.GetValue(ref key, out v));
        string s = v.vt == 31 ? Marshal.PtrToStringUni(v.p) : null;
        PropVariantClear(ref v);
        return s;
      } catch { return null; }
    }
  }

  public class WinInfo { public long Hwnd; public string Title; public uint Pid; public bool Minimized; public bool Maximized; }

  public static class Win {
    delegate bool EnumProc(IntPtr h, IntPtr l);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsWindow(IntPtr h);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr h);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr h, int cmd);
    [DllImport("user32.dll")] static extern bool IsIconic(IntPtr h);
    [DllImport("user32.dll")] static extern bool IsZoomed(IntPtr h);
    [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr h, int idx);
    [DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr h, uint cmd);
    [DllImport("user32.dll")] static extern bool PostMessage(IntPtr h, uint msg, IntPtr w, IntPtr l);
    [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr h, uint flags);
    [DllImport("user32.dll")] static extern bool GetMonitorInfo(IntPtr m, ref MonitorInfo mi);
    [DllImport("user32.dll")] static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    [DllImport("user32.dll")] public static extern bool LockWorkStation();
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out int v, int size);
    [StructLayout(LayoutKind.Sequential)] struct Rect { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct MonitorInfo { public int Size; public Rect Monitor; public Rect Work; public uint Flags; }

    static bool Eligible(IntPtr h) {
      if (!IsWindowVisible(h) || GetWindowTextLength(h) == 0) return false;
      if (GetWindow(h, 4) != IntPtr.Zero) return false; // owned windows (dialogs) are skipped
      if ((GetWindowLong(h, -20) & 0x80) != 0) return false; // WS_EX_TOOLWINDOW
      int cloaked; if (DwmGetWindowAttribute(h, 14, out cloaked, 4) == 0 && cloaked != 0) return false;
      return true;
    }
    static WinInfo Info(IntPtr h) {
      var sb = new StringBuilder(512); GetWindowText(h, sb, 512); uint pid; GetWindowThreadProcessId(h, out pid);
      return new WinInfo { Hwnd = h.ToInt64(), Title = sb.ToString(), Pid = pid, Minimized = IsIconic(h), Maximized = IsZoomed(h) };
    }
    public static List<WinInfo> List() {
      var list = new List<WinInfo>();
      EnumWindows((h, l) => { if (Eligible(h)) list.Add(Info(h)); return true; }, IntPtr.Zero);
      return list;
    }
    public static WinInfo Foreground() { var h = GetForegroundWindow(); return h == IntPtr.Zero ? null : Info(h); }
    static IntPtr Valid(long hwnd) { var h = new IntPtr(hwnd); if (!IsWindow(h)) throw new Exception("That window no longer exists"); return h; }
    public static bool Focus(long hwnd) {
      var h = Valid(hwnd);
      if (IsIconic(h)) ShowWindow(h, 9);
      keybd_event(0x12, 0, 1, UIntPtr.Zero); // ALT press lets SetForegroundWindow pass the foreground lock
      bool ok = SetForegroundWindow(h);
      keybd_event(0x12, 0, 3, UIntPtr.Zero);
      return ok && GetForegroundWindow() == h;
    }
    public static bool Show(long hwnd, int cmd) { var h = Valid(hwnd); ShowWindow(h, cmd); return true; }
    public static bool Close(long hwnd) { return PostMessage(Valid(hwnd), 0x10, IntPtr.Zero, IntPtr.Zero); }
    public static bool Snap(long hwnd, string side) {
      var h = Valid(hwnd);
      ShowWindow(h, 9);
      var mi = new MonitorInfo(); mi.Size = Marshal.SizeOf(mi);
      GetMonitorInfo(MonitorFromWindow(h, 2), ref mi);
      int w = mi.Work.R - mi.Work.L, ht = mi.Work.B - mi.Work.T, half = w / 2;
      int x = side == "left" ? mi.Work.L : mi.Work.L + half;
      return SetWindowPos(h, IntPtr.Zero, x, mi.Work.T, half, ht, 0x0044);
    }
    public static void MediaKey(byte vk) { keybd_event(vk, 0, 1, UIntPtr.Zero); keybd_event(vk, 0, 3, UIntPtr.Zero); }

    [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr h, out Rect r);
    [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr h, int attr, out Rect v, int size);
    delegate bool MonEnum(IntPtr m, IntPtr hdc, ref Rect r, IntPtr d);
    [DllImport("user32.dll")] static extern bool EnumDisplayMonitors(IntPtr hdc, IntPtr clip, MonEnum cb, IntPtr d);
    static Rect Work(IntPtr h) { var mi = new MonitorInfo(); mi.Size = Marshal.SizeOf(mi); GetMonitorInfo(MonitorFromWindow(h, 2), ref mi); return mi.Work; }
    static List<IntPtr> Monitors() { var l = new List<IntPtr>(); EnumDisplayMonitors(IntPtr.Zero, IntPtr.Zero, (IntPtr m, IntPtr d, ref Rect r, IntPtr x) => { l.Add(m); return true; }, IntPtr.Zero); return l; }
    public static int MonitorCount() { return Monitors().Count; }
    public static bool Topmost(long hwnd, bool on) { return SetWindowPos(Valid(hwnd), new IntPtr(on ? -1 : -2), 0, 0, 0, 0, 0x0013); }
    public static bool Center(long hwnd) {
      var h = Valid(hwnd);
      if (IsZoomed(h) || IsIconic(h)) ShowWindow(h, 9);
      Rect r; GetWindowRect(h, out r); var m = Work(h);
      int w = Math.Min(r.R - r.L, m.R - m.L), ht = Math.Min(r.B - r.T, m.B - m.T);
      return SetWindowPos(h, IntPtr.Zero, m.L + ((m.R - m.L) - w) / 2, m.T + ((m.B - m.T) - ht) / 2, w, ht, 0x0044);
    }
    public static bool Resize(long hwnd, int w, int ht) {
      var h = Valid(hwnd);
      ShowWindow(h, 9);
      var m = Work(h);
      w = Math.Max(200, Math.Min(w, m.R - m.L)); ht = Math.Max(150, Math.Min(ht, m.B - m.T));
      return SetWindowPos(h, IntPtr.Zero, m.L + ((m.R - m.L) - w) / 2, m.T + ((m.B - m.T) - ht) / 2, w, ht, 0x0044);
    }
    public static bool NextMonitor(long hwnd) {
      var h = Valid(hwnd);
      var mons = Monitors();
      if (mons.Count < 2) return false;
      int i = mons.IndexOf(MonitorFromWindow(h, 2));
      var mi = new MonitorInfo(); mi.Size = Marshal.SizeOf(mi);
      GetMonitorInfo(mons[(i + 1) % mons.Count], ref mi);
      bool wasMax = IsZoomed(h);
      ShowWindow(h, 9);
      Rect r; GetWindowRect(h, out r); var a = Work(h);
      int w = Math.Min(r.R - r.L, mi.Work.R - mi.Work.L), ht = Math.Min(r.B - r.T, mi.Work.B - mi.Work.T);
      int x = Math.Min(mi.Work.L + Math.Max(0, r.L - a.L), mi.Work.R - w), y = Math.Min(mi.Work.T + Math.Max(0, r.T - a.T), mi.Work.B - ht);
      bool ok = SetWindowPos(h, IntPtr.Zero, x, y, w, ht, 0x0044);
      if (wasMax) ShowWindow(h, 3);
      return ok;
    }
    /** Visible bounds (without the invisible resize border) as x, y, width, height. */
    public static int[] Bounds(long hwnd) {
      var h = Valid(hwnd);
      Rect r;
      if (DwmGetWindowAttribute(h, 9, out r, Marshal.SizeOf(typeof(Rect))) != 0) GetWindowRect(h, out r);
      return new[] { r.L, r.T, r.R - r.L, r.B - r.T };
    }
    public static void DisplayOff() { PostMessage(new IntPtr(0xFFFF), 0x0112, new IntPtr(0xF170), new IntPtr(2)); }
    public static int CloseAll(int[] pids) {
      var set = new HashSet<int>(pids);
      int n = 0;
      foreach (var w in List()) if (set.Contains((int)w.Pid) && PostMessage(new IntPtr(w.Hwnd), 0x10, IntPtr.Zero, IntPtr.Zero)) n++;
      return n;
    }
  }

  /** Windows settings that have documented per-user APIs (accessibility keys, taskbar auto-hide). */
  public static class Sys {
    [StructLayout(LayoutKind.Sequential)] struct STICKYKEYS { public uint cbSize; public uint dwFlags; }
    [StructLayout(LayoutKind.Sequential)] struct FILTERKEYS { public uint cbSize; public uint dwFlags; public uint iWaitMSec, iDelayMSec, iRepeatMSec, iBounceMSec; }
    [StructLayout(LayoutKind.Sequential)] struct ARect { public int L, T, R, B; }
    [StructLayout(LayoutKind.Sequential)] struct APPBARDATA { public uint cbSize; public IntPtr hWnd; public uint uCallbackMessage; public uint uEdge; public ARect rc; public IntPtr lParam; }
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint a, uint b, ref STICKYKEYS p, uint w);
    [DllImport("user32.dll")] static extern bool SystemParametersInfo(uint a, uint b, ref FILTERKEYS p, uint w);
    [DllImport("shell32.dll")] static extern UIntPtr SHAppBarMessage(uint msg, ref APPBARDATA d);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string cls, string title);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr SendMessageTimeout(IntPtr h, uint msg, UIntPtr w, string l, uint flags, uint timeout, out UIntPtr res);
    [DllImport("shell32.dll")] static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);

    public static bool GetSticky() { var s = new STICKYKEYS(); s.cbSize = (uint)Marshal.SizeOf(s); SystemParametersInfo(0x003A, s.cbSize, ref s, 0); return (s.dwFlags & 1) != 0; }
    public static bool SetSticky(bool on) { var s = new STICKYKEYS(); s.cbSize = (uint)Marshal.SizeOf(s); SystemParametersInfo(0x003A, s.cbSize, ref s, 0); s.dwFlags = on ? (s.dwFlags | 1) : (s.dwFlags & ~1u); return SystemParametersInfo(0x003B, s.cbSize, ref s, 3); }
    public static bool GetFilter() { var s = new FILTERKEYS(); s.cbSize = (uint)Marshal.SizeOf(s); SystemParametersInfo(0x0032, s.cbSize, ref s, 0); return (s.dwFlags & 1) != 0; }
    public static bool SetFilter(bool on) { var s = new FILTERKEYS(); s.cbSize = (uint)Marshal.SizeOf(s); SystemParametersInfo(0x0032, s.cbSize, ref s, 0); s.dwFlags = on ? (s.dwFlags | 1) : (s.dwFlags & ~1u); return SystemParametersInfo(0x0033, s.cbSize, ref s, 3); }
    public static bool GetAutoHide() { var d = new APPBARDATA(); d.cbSize = (uint)Marshal.SizeOf(d); return ((ulong)SHAppBarMessage(4, ref d) & 1) != 0; }
    public static void SetAutoHide(bool on) { var d = new APPBARDATA(); d.cbSize = (uint)Marshal.SizeOf(d); d.hWnd = FindWindow("Shell_TrayWnd", null); d.lParam = new IntPtr(on ? 1 : 2); SHAppBarMessage(10, ref d); }
    public static void Broadcast(string what) { UIntPtr r; SendMessageTimeout(new IntPtr(0xFFFF), 0x001A, UIntPtr.Zero, what, 2, 2000, out r); }
    public static void RefreshShell() { SHChangeNotify(0x08000000, 0, IntPtr.Zero, IntPtr.Zero); }
  }
}
'@

# --- WinRT media session support (optional; falls back to media keys) ---
$script:MediaReady = $false
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $script:AsTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
      $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
  $null = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager, Windows.Media.Control, ContentType = WindowsRuntime]
  $script:MediaReady = $true
} catch { $script:MediaReady = $false }

function Await($op, [Type]$type) {
  $task = $script:AsTask.MakeGenericMethod($type).Invoke($null, @($op))
  if (-not $task.Wait(3000)) { throw 'Media session timed out' }
  $task.Result
}

function Get-MediaSession {
  if (-not $script:MediaReady) { return $null }
  $mgrType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager]
  $mgr = Await ($mgrType::RequestAsync()) $mgrType
  $mgr.GetCurrentSession()
}

function Invoke-Media([string]$action) {
  $keys = @{ toggle = 0xB3; next = 0xB0; previous = 0xB1; stop = 0xB2 }
  $session = $null
  try { $session = Get-MediaSession } catch { $session = $null }
  if ($session) {
    $op = switch ($action) {
      'toggle' { $session.TryTogglePlayPauseAsync() }
      'play' { $session.TryPlayAsync() }
      'pause' { $session.TryPauseAsync() }
      'next' { $session.TrySkipNextAsync() }
      'previous' { $session.TrySkipPreviousAsync() }
      'stop' { $session.TryStopAsync() }
    }
    $ok = Await $op ([bool])
    return @{ method = 'session'; app = $session.SourceAppUserModelId; ok = [bool]$ok }
  }
  $vk = $keys[$action]
  if ($null -eq $vk) { $vk = 0xB3 }
  [ClickyyBridge.Win]::MediaKey([byte]$vk)
  return @{ method = 'key'; app = $null; ok = $true }
}

function Get-NowPlaying {
  $session = Get-MediaSession
  if (-not $session) { return @{ available = $script:MediaReady; playing = $false } }
  $props = Await ($session.TryGetMediaPropertiesAsync()) ([Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties])
  $status = $session.GetPlaybackInfo().PlaybackStatus.ToString()
  @{ available = $true; playing = ($status -eq 'Playing'); status = $status; app = $session.SourceAppUserModelId; title = $props.Title; artist = $props.Artist }
}

function Format-Window($w) {
  if ($null -eq $w) { return $null }
  $name = $null
  try { $name = (Get-Process -Id $w.Pid -ErrorAction Stop).ProcessName } catch { }
  @{ hwnd = $w.Hwnd; title = $w.Title; pid = $w.Pid; process = $name; minimized = $w.Minimized; maximized = $w.Maximized }
}

# SendKeys specs Clickyy may send. Anything else is rejected here as well as in TypeScript.
$AllowedKeySpecs = @('^c', '^v', '^x', '^z', '^y', '^a', '^s', '^f', '^t', '^w', '^n', '%{TAB}', '%{F4}', '{ENTER}', '{ESC}', '{TAB}', '^{TAB}', '^+{TAB}', '{F5}', '^{PGDN}', '^{PGUP}')

function Escape-SendKeys([string]$text) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($ch in $text.ToCharArray()) {
    if ('+^%~(){}[]'.Contains([string]$ch)) { [void]$sb.Append('{').Append($ch).Append('}') }
    elseif ($ch -eq "`n") { [void]$sb.Append('{ENTER}') }
    elseif ($ch -eq "`r") { }
    else { [void]$sb.Append($ch) }
  }
  $sb.ToString()
}

# Process names Clickyy may look up or stop. Critical Windows processes are never stopped.
$ProtectedProcesses = @('system', 'idle', 'csrss', 'smss', 'wininit', 'winlogon', 'services', 'lsass', 'svchost', 'dwm', 'explorer', 'fontdrvhost', 'sihost', 'ctfmon', 'registry', 'memory compression', 'securityhealthservice', 'msmpeng', 'powershell', 'clickyy ai', 'clickyy-speech', 'electron', 'conhost', 'audiodg', 'spoolsv', 'taskhostw', 'runtimebroker')
function Assert-ProcName([string]$name) {
  if ($name -notmatch '^[A-Za-z0-9 ._+-]{1,60}$') { throw 'invalid process name' }
  $name
}

function Get-ProcInfo([string]$name) {
  @(Get-Process -Name (Assert-ProcName $name) -ErrorAction SilentlyContinue | ForEach-Object {
      $path = $null; try { $path = $_.Path } catch { }
      @{ pid = $_.Id; cpuSec = [math]::Round([double]$_.TotalProcessorTime.TotalSeconds, 2); memMB = [math]::Round($_.WorkingSet64 / 1MB); title = $_.MainWindowTitle; path = $path }
    })
}

function Get-RegDword([string]$path, [string]$name, $default) {
  try { $v = (Get-ItemProperty -Path $path -Name $name -ErrorAction Stop).$name; if ($null -eq $v) { $default } else { $v } } catch { $default }
}

$PersonalizeKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize'
$AdvancedKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced'
$StorageSenseKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\StorageSense\Parameters\StoragePolicy'

function Get-Feature([string]$f) {
  switch ($f) {
    'dark_mode' { return ((Get-RegDword $PersonalizeKey 'AppsUseLightTheme' 1) -eq 0) }
    'autohide_taskbar' { return [ClickyyBridge.Sys]::GetAutoHide() }
    'file_extensions' { return ((Get-RegDword $AdvancedKey 'HideFileExt' 1) -eq 0) }
    'hidden_files' { return ((Get-RegDword $AdvancedKey 'Hidden' 2) -eq 1) }
    'clipboard_history' { return ((Get-RegDword 'HKCU:\Software\Microsoft\Clipboard' 'EnableClipboardHistory' 0) -eq 1) }
    'sticky_keys' { return [ClickyyBridge.Sys]::GetSticky() }
    'filter_keys' { return [ClickyyBridge.Sys]::GetFilter() }
    'storage_sense' { return ((Get-RegDword $StorageSenseKey '01' 0) -eq 1) }
    default { throw 'unknown feature' }
  }
}

function Set-Feature([string]$f, [bool]$on) {
  switch ($f) {
    'dark_mode' {
      $v = [int](-not $on)
      Set-ItemProperty -Path $PersonalizeKey -Name 'AppsUseLightTheme' -Value $v -Type DWord
      Set-ItemProperty -Path $PersonalizeKey -Name 'SystemUsesLightTheme' -Value $v -Type DWord
      [ClickyyBridge.Sys]::Broadcast('ImmersiveColorSet')
    }
    'autohide_taskbar' { [ClickyyBridge.Sys]::SetAutoHide($on) }
    'file_extensions' { Set-ItemProperty -Path $AdvancedKey -Name 'HideFileExt' -Value ([int](-not $on)) -Type DWord; [ClickyyBridge.Sys]::RefreshShell() }
    'hidden_files' { Set-ItemProperty -Path $AdvancedKey -Name 'Hidden' -Value ($(if ($on) { 1 } else { 2 })) -Type DWord; [ClickyyBridge.Sys]::RefreshShell() }
    'clipboard_history' {
      if (-not (Test-Path 'HKCU:\Software\Microsoft\Clipboard')) { New-Item -Path 'HKCU:\Software\Microsoft\Clipboard' -Force | Out-Null }
      Set-ItemProperty -Path 'HKCU:\Software\Microsoft\Clipboard' -Name 'EnableClipboardHistory' -Value ([int]$on) -Type DWord
    }
    'sticky_keys' { [void][ClickyyBridge.Sys]::SetSticky($on) }
    'filter_keys' { [void][ClickyyBridge.Sys]::SetFilter($on) }
    'storage_sense' {
      if (-not (Test-Path $StorageSenseKey)) { New-Item -Path $StorageSenseKey -Force | Out-Null }
      Set-ItemProperty -Path $StorageSenseKey -Name '01' -Value ([int]$on) -Type DWord
    }
    default { throw 'unknown feature' }
  }
  return (Get-Feature $f)
}

function Get-Radio([string]$kind) {
  if (-not $script:MediaReady) { throw 'Windows Runtime is not available' }
  $null = [Windows.Devices.Radios.Radio, Windows.System.Devices, ContentType = WindowsRuntime]
  $access = Await ([Windows.Devices.Radios.Radio]::RequestAccessAsync()) ([Windows.Devices.Radios.RadioAccessStatus])
  if ($access.ToString() -ne 'Allowed') { throw "Windows denied radio access ($access)" }
  $radios = Await ([Windows.Devices.Radios.Radio]::GetRadiosAsync()) ([System.Collections.Generic.IReadOnlyList[Windows.Devices.Radios.Radio]])
  $radios | Where-Object { $_.Kind.ToString() -eq $kind } | Select-Object -First 1
}

$UsbSkip = 'hub|root|host controller|composite|generic usb|usb input device|enumerator|billboard'

function Invoke-Diag([string]$metric) {
  switch ($metric) {
    'temps' {
      $t = @()
      try { $t = @(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | ForEach-Object { [math]::Round($_.CurrentTemperature / 10 - 273.15, 1) }) } catch { }
      return @{ celsius = $t }
    }
    'pagefile' {
      $p = @(Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue)
      return @{ usedMB = [int](($p | Measure-Object CurrentUsage -Sum).Sum); sizeMB = [int](($p | Measure-Object AllocatedBaseSize -Sum).Sum); peakMB = [int](($p | Measure-Object PeakUsage -Sum).Sum) }
    }
    'disks' {
      return @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3 OR DriveType=2' | ForEach-Object {
          @{ drive = $_.DeviceID; label = $_.VolumeName; removable = ($_.DriveType -eq 2); freeGB = [math]::Round($_.FreeSpace / 1GB, 1); totalGB = [math]::Round($_.Size / 1GB, 1) } })
    }
    'diskio' {
      $d = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'"
      return @{ readMBs = [math]::Round($d.DiskReadBytesPersec / 1MB, 2); writeMBs = [math]::Round($d.DiskWriteBytesPersec / 1MB, 2); busyPct = [int]$d.PercentDiskTime; queue = [int]$d.CurrentDiskQueueLength }
    }
    'battery_health' {
      $full = $null; $design = $null; $cycles = $null
      try { $full = (Get-CimInstance -Namespace root/wmi -ClassName BatteryFullChargedCapacity -ErrorAction Stop | Select-Object -First 1).FullChargedCapacity } catch { }
      try { $design = (Get-CimInstance -Namespace root/wmi -ClassName BatteryStaticData -ErrorAction Stop | Select-Object -First 1).DesignedCapacity } catch { }
      try { $cycles = (Get-CimInstance -Namespace root/wmi -ClassName BatteryCycleCount -ErrorAction Stop | Select-Object -First 1).CycleCount } catch { }
      return @{ fullMWh = $full; designMWh = $design; cycles = $cycles }
    }
    'gpu' {
      $names = @(Get-CimInstance Win32_VideoController | ForEach-Object { $_.Name })
      $util = $null; $vram = $null
      try {
        $eng = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine -ErrorAction Stop | Where-Object { $_.Name -like '*engtype_3D*' })
        $util = [math]::Min(100, [int](($eng | Measure-Object UtilizationPercentage -Sum).Sum))
        $mem = @(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory -ErrorAction Stop)
        $vram = [math]::Round((($mem | Measure-Object DedicatedUsage -Sum).Sum) / 1MB)
      } catch { }
      return @{ names = $names; utilPct = $util; vramMB = $vram }
    }
    'netio' {
      $n = @(Get-CimInstance Win32_PerfFormattedData_Tcpip_NetworkInterface)
      return @{ downKBs = [math]::Round((($n | Measure-Object BytesReceivedPersec -Sum).Sum) / 1KB, 1); upKBs = [math]::Round((($n | Measure-Object BytesSentPersec -Sum).Sum) / 1KB, 1); adapters = @($n | ForEach-Object { $_.Name }) }
    }
    'ips' {
      $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { @{ ip = $_.IPAddress; adapter = $_.InterfaceAlias } })
      $macs = @(Get-NetAdapter -Physical -ErrorAction SilentlyContinue | Where-Object { $_.Status -eq 'Up' } | ForEach-Object { @{ adapter = $_.Name; mac = $_.MacAddress; speed = $_.LinkSpeed } })
      return @{ ips = $ips; adapters = $macs }
    }
    'ports' {
      $names = @{}; Get-Process | ForEach-Object { $names[$_.Id] = $_.ProcessName }
      $tcp = @(Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object { @{ proto = 'TCP'; port = $_.LocalPort; address = $_.LocalAddress; process = $names[[int]$_.OwningProcess] } })
      $udp = @(Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object { @{ proto = 'UDP'; port = $_.LocalPort; address = $_.LocalAddress; process = $names[[int]$_.OwningProcess] } })
      return @{ tcp = $tcp; udp = $udp }
    }
    'usb' {
      $dev = @(Get-PnpDevice -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.InstanceId -like 'USB*' -and $_.FriendlyName -and $_.FriendlyName -notmatch $UsbSkip } | ForEach-Object { $_.FriendlyName } | Sort-Object -Unique)
      $drives = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=2' | ForEach-Object { @{ drive = $_.DeviceID; label = $_.VolumeName; freeGB = [math]::Round($_.FreeSpace / 1GB, 1) } })
      return @{ devices = $dev; drives = $drives }
    }
    'bluetooth' {
      $out = @()
      foreach ($d in @(Get-PnpDevice -Class Bluetooth -PresentOnly -ErrorAction SilentlyContinue | Where-Object { $_.FriendlyName -and $_.FriendlyName -notmatch 'enumerator|adapter|radio|transport|service|protocol|wireless bluetooth|bluetooth device \(|microsoft bluetooth|intel|realtek|mediatek|qualcomm' })) {
        $bat = $null
        try { $bat = (Get-PnpDeviceProperty -InstanceId $d.InstanceId -KeyName '{104EA319-6EE2-4701-BD47-8DDBF425BBE5} 2' -ErrorAction Stop).Data } catch { }
        $out += @{ name = $d.FriendlyName; status = $d.Status; battery = $bat }
      }
      return @{ devices = $out }
    }
    'display' {
      $vc = @(Get-CimInstance Win32_VideoController | Where-Object { $_.CurrentHorizontalResolution })
      $dpi = Get-RegDword 'HKCU:\Control Panel\Desktop\WindowMetrics' 'AppliedDPI' 96
      $screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { @{ name = $_.DeviceName; width = $_.Bounds.Width; height = $_.Bounds.Height; primary = $_.Primary } })
      return @{ screens = $screens; refreshHz = @($vc | ForEach-Object { $_.CurrentRefreshRate }); resolution = @($vc | ForEach-Object { "$($_.CurrentHorizontalResolution)x$($_.CurrentVerticalResolution)" }); scalePct = [int]([math]::Round($dpi / 96 * 100)) }
    }
    'os' {
      $os = Get-CimInstance Win32_OperatingSystem
      $ubr = Get-RegDword 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' 'UBR' $null
      $disp = Get-RegDword 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' 'DisplayVersion' ''
      return @{ caption = $os.Caption; version = $os.Version; build = $os.BuildNumber; ubr = $ubr; release = $disp; arch = $os.OSArchitecture; installed = $os.InstallDate.ToString('yyyy-MM-dd'); lastBoot = $os.LastBootUpTime.ToString('yyyy-MM-dd HH:mm') }
    }
    'updates' {
      $last = Get-HotFix -ErrorAction SilentlyContinue | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
      $pending = $null; $titles = @(); $err = $null
      try {
        $job = Start-Job -ScriptBlock {
          $s = (New-Object -ComObject Microsoft.Update.Session).CreateUpdateSearcher()
          $r = $s.Search("IsInstalled=0 and IsHidden=0")
          @($r.Updates | ForEach-Object { $_.Title })
        }
        if (Wait-Job $job -Timeout 40) { $titles = @(Receive-Job $job); $pending = $titles.Count } else { $err = 'Windows Update took too long to answer' }
        Remove-Job $job -Force
      } catch { $err = $_.Exception.Message }
      return @{ pending = $pending; titles = @($titles | Select-Object -First 10); lastHotfix = $(if ($last) { $last.HotFixID } else { $null }); lastDate = $(if ($last) { $last.InstalledOn.ToString('yyyy-MM-dd') } else { $null }); error = $err }
    }
    'tasks' {
      $all = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.State -ne 'Disabled' })
      $mine = @($all | Where-Object { $_.TaskPath -notlike '\Microsoft\*' } | ForEach-Object { @{ name = $_.TaskName; path = $_.TaskPath; state = $_.State.ToString() } })
      return @{ enabled = $all.Count; nonMicrosoft = $mine }
    }
    'crashes' {
      $ev = @()
      try { $ev = @(Get-WinEvent -FilterHashtable @{ LogName = @('System', 'Application'); Level = @(1, 2); StartTime = (Get-Date).AddDays(-7) } -MaxEvents 200 -ErrorAction Stop) } catch { }
      $top = @($ev | Group-Object ProviderName | Sort-Object Count -Descending | Select-Object -First 6 | ForEach-Object { @{ source = $_.Name; count = $_.Count } })
      $bsod = @($ev | Where-Object { $_.Id -eq 41 -or $_.Id -eq 1001 -and $_.ProviderName -like '*WER*' }).Count
      $latest = $(if ($ev.Count) { @{ when = $ev[0].TimeCreated.ToString('yyyy-MM-dd HH:mm'); source = $ev[0].ProviderName; text = ([string]$ev[0].Message).Split("`n")[0].Trim() } } else { $null })
      return @{ total = $ev.Count; top = $top; unexpectedShutdowns = $bsod; latest = $latest }
    }
    'gateway' {
      $gw = (Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1).NextHop
      $ms = $null
      if ($gw) { try { $p = New-Object System.Net.NetworkInformation.Ping; $times = @(1..3 | ForEach-Object { $r = $p.Send($gw, 1000); if ($r.Status -eq 'Success') { $r.RoundtripTime } }); if ($times.Count) { $ms = [math]::Round(($times | Measure-Object -Average).Average, 1) } } catch { } }
      $dns = @(Get-DnsClientServerAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.ServerAddresses } | ForEach-Object { $_.ServerAddresses } | Select-Object -Unique)
      return @{ gateway = $gw; gatewayMs = $ms; dnsServers = $dns }
    }
    'dns' {
      $sw = [System.Diagnostics.Stopwatch]::StartNew()
      try { [void][System.Net.Dns]::GetHostAddresses('www.microsoft.com'); $sw.Stop(); return @{ ms = $sw.ElapsedMilliseconds; ok = $true } } catch { return @{ ms = $null; ok = $false } }
    }
    'recycle' {
      $items = @((New-Object -ComObject Shell.Application).NameSpace(10).Items())
      $size = 0; foreach ($i in $items) { try { $size += [double]$i.ExtendedProperty('Size') } catch { } }
      return @{ count = $items.Count; sizeMB = [math]::Round($size / 1MB, 1) }
    }
    'cpu_top' {
      $a = @{}; Get-Process | ForEach-Object { try { $a[$_.Id] = $_.TotalProcessorTime.TotalMilliseconds } catch { } }
      Start-Sleep -Milliseconds 1000
      $cores = [Environment]::ProcessorCount
      return @(Get-Process | ForEach-Object {
          $prev = $a[$_.Id]; $now = $null; try { $now = $_.TotalProcessorTime.TotalMilliseconds } catch { }
          if ($null -ne $prev -and $null -ne $now) { @{ name = $_.ProcessName; pid = $_.Id; cpuPct = [math]::Round(($now - $prev) / 10 / $cores, 1); memMB = [math]::Round($_.WorkingSet64 / 1MB) } }
        } | Where-Object { $_ } | Sort-Object { $_.cpuPct } -Descending | Select-Object -First 10)
    }
    default { throw 'unknown metric' }
  }
}

function Invoke-Op([string]$op, $a) {
  switch ($op) {
    'ping' { return @{ pong = $true; ps = $PSVersionTable.PSVersion.ToString(); media = $script:MediaReady } }
    'volume.get' { return @{ level = [ClickyyBridge.Audio]::GetVolume(); muted = [ClickyyBridge.Audio]::GetMute() } }
    'volume.set' {
      $lvl = [int]$a.level
      if ($lvl -lt 0 -or $lvl -gt 100) { throw 'level out of range' }
      [ClickyyBridge.Audio]::SetVolume($lvl)
      return @{ level = [ClickyyBridge.Audio]::GetVolume(); muted = [ClickyyBridge.Audio]::GetMute() }
    }
    'volume.mute' {
      [ClickyyBridge.Audio]::SetMute([bool]$a.mute)
      return @{ level = [ClickyyBridge.Audio]::GetVolume(); muted = [ClickyyBridge.Audio]::GetMute() }
    }
    'audio.devices' { return @{ output = [ClickyyBridge.Audio]::DeviceName(0); input = [ClickyyBridge.Audio]::DeviceName(1) } }
    'media.control' {
      $act = [string]$a.action
      if (@('toggle', 'play', 'pause', 'next', 'previous', 'stop') -notcontains $act) { throw 'unknown media action' }
      return Invoke-Media $act
    }
    'media.now' { return Get-NowPlaying }
    'window.list' { return @([ClickyyBridge.Win]::List() | ForEach-Object { Format-Window $_ }) }
    'window.foreground' { return Format-Window ([ClickyyBridge.Win]::Foreground()) }
    'window.action' {
      $h = [long]$a.hwnd
      switch ([string]$a.action) {
        'focus' { return @{ ok = [ClickyyBridge.Win]::Focus($h) } }
        'minimize' { return @{ ok = [ClickyyBridge.Win]::Show($h, 6) } }
        'maximize' { return @{ ok = [ClickyyBridge.Win]::Show($h, 3) } }
        'restore' { return @{ ok = [ClickyyBridge.Win]::Show($h, 9) } }
        'close' { return @{ ok = [ClickyyBridge.Win]::Close($h) } }
        'snap_left' { return @{ ok = [ClickyyBridge.Win]::Snap($h, 'left') } }
        'snap_right' { return @{ ok = [ClickyyBridge.Win]::Snap($h, 'right') } }
        'topmost_on' { return @{ ok = [ClickyyBridge.Win]::Topmost($h, $true) } }
        'topmost_off' { return @{ ok = [ClickyyBridge.Win]::Topmost($h, $false) } }
        'center' { return @{ ok = [ClickyyBridge.Win]::Center($h) } }
        'next_monitor' { return @{ ok = [ClickyyBridge.Win]::NextMonitor($h); monitors = [ClickyyBridge.Win]::MonitorCount() } }
        'resize' {
          $w = [int]$a.width; $ht = [int]$a.height
          if ($w -lt 200 -or $w -gt 10000 -or $ht -lt 150 -or $ht -gt 10000) { throw 'size out of range' }
          return @{ ok = [ClickyyBridge.Win]::Resize($h, $w, $ht) }
        }
        default { throw 'unknown window action' }
      }
    }
    'window.capture' {
      $path = [string]$a.path
      if ($path -notmatch '\.png$' -or -not (Test-Path -LiteralPath (Split-Path -Parent $path))) { throw 'invalid capture path' }
      $h = [long]$a.hwnd
      [void][ClickyyBridge.Win]::Focus($h)
      Start-Sleep -Milliseconds 350
      $b = [ClickyyBridge.Win]::Bounds($h)
      if ($b[2] -lt 10 -or $b[3] -lt 10) { throw 'That window is minimized or too small to capture' }
      Add-Type -AssemblyName System.Drawing
      $bmp = New-Object System.Drawing.Bitmap $b[2], $b[3]
      $g = [System.Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($b[0], $b[1], 0, 0, $bmp.Size)
      $bmp.Save($path, [System.Drawing.Imaging.ImageFormat]::Png)
      $g.Dispose(); $bmp.Dispose()
      return @{ ok = $true; width = $b[2]; height = $b[3] }
    }
    'window.closeApp' {
      $pids = @(Get-Process -Name (Assert-ProcName ([string]$a.name)) -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
      if (-not $pids.Count) { return @{ running = $false; closed = 0 } }
      return @{ running = $true; closed = [ClickyyBridge.Win]::CloseAll([int[]]$pids) }
    }
    'monitor.count' { return @{ count = [ClickyyBridge.Win]::MonitorCount() } }
    'mic.get' { return @{ level = [ClickyyBridge.Audio]::GetMicVolume(); muted = [ClickyyBridge.Audio]::GetMicMute() } }
    'mic.set' {
      $lvl = [int]$a.level
      if ($lvl -lt 0 -or $lvl -gt 100) { throw 'level out of range' }
      [ClickyyBridge.Audio]::SetMicVolume($lvl)
      return @{ level = [ClickyyBridge.Audio]::GetMicVolume(); muted = [ClickyyBridge.Audio]::GetMicMute() }
    }
    'app.mute' {
      $pids = @(Get-Process -Name (Assert-ProcName ([string]$a.name)) -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
      if (-not $pids.Count) { return @{ running = $false; sessions = 0 } }
      return @{ running = $true; sessions = [ClickyyBridge.Audio]::SetAppMute([int[]]$pids, [bool]$a.mute) }
    }
    'display.off' { [ClickyyBridge.Win]::DisplayOff(); return @{ ok = $true } }
    'brightness.get' {
      try { $b = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1; return @{ supported = $true; level = [int]$b.CurrentBrightness } }
      catch { return @{ supported = $false } }
    }
    'brightness.set' {
      $lvl = [int]$a.level
      if ($lvl -lt 0 -or $lvl -gt 100) { throw 'level out of range' }
      try { $m = Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Select-Object -First 1 }
      catch { return @{ supported = $false } }
      Invoke-CimMethod -InputObject $m -MethodName WmiSetBrightness -Arguments @{ Timeout = 1; Brightness = [byte]$lvl } | Out-Null
      Start-Sleep -Milliseconds 300
      return @{ supported = $true; level = [int](Get-CimInstance -Namespace root/wmi -ClassName WmiMonitorBrightness | Select-Object -First 1).CurrentBrightness }
    }
    'power.suspend' {
      $mode = $(if ([bool]$a.hibernate) { [System.Windows.Forms.PowerState]::Hibernate } else { [System.Windows.Forms.PowerState]::Suspend })
      return @{ ok = [System.Windows.Forms.Application]::SetSuspendState($mode, $false, $false) }
    }
    'radio.get' {
      $kind = [string]$a.kind
      if (@('WiFi', 'Bluetooth') -notcontains $kind) { throw 'unknown radio' }
      $r = Get-Radio $kind
      if (-not $r) { return @{ present = $false } }
      return @{ present = $true; on = ($r.State.ToString() -eq 'On'); name = $r.Name }
    }
    'radio.set' {
      $kind = [string]$a.kind
      if (@('WiFi', 'Bluetooth') -notcontains $kind) { throw 'unknown radio' }
      $r = Get-Radio $kind
      if (-not $r) { return @{ present = $false } }
      $state = $(if ([bool]$a.on) { [Windows.Devices.Radios.RadioState]::On } else { [Windows.Devices.Radios.RadioState]::Off })
      $res = Await ($r.SetStateAsync($state)) ([Windows.Devices.Radios.RadioAccessStatus])
      return @{ present = $true; result = $res.ToString(); on = ($r.State.ToString() -eq 'On') }
    }
    'feature.get' { return @{ on = [bool](Get-Feature ([string]$a.feature)) } }
    'feature.set' { return @{ on = [bool](Set-Feature ([string]$a.feature) ([bool]$a.on)) } }
    'process.info' { return @(Get-ProcInfo ([string]$a.name)) }
    'process.stop' {
      $name = Assert-ProcName ([string]$a.name)
      if ($ProtectedProcesses -contains $name.ToLower()) { throw 'That process is protected' }
      $procs = @(Get-Process -Name $name -ErrorAction SilentlyContinue)
      $procs | Stop-Process -Force -ErrorAction SilentlyContinue
      Start-Sleep -Milliseconds 500
      return @{ stopped = $procs.Count; remaining = @(Get-Process -Name $name -ErrorAction SilentlyContinue).Count }
    }
    'file.version' {
      $p = [string]$a.path
      if ($p -notmatch '\.exe$' -or -not (Test-Path -LiteralPath $p)) { throw 'not an executable' }
      $v = (Get-Item -LiteralPath $p).VersionInfo
      return @{ product = $v.ProductVersion; file = $v.FileVersion; name = $v.ProductName; company = $v.CompanyName }
    }
    'startup.get' {
      $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
      $props = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
      return @(if ($props) { $props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' } | ForEach-Object { @{ name = $_.Name; command = [string]$_.Value } } })
    }
    'startup.set' {
      $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
      $name = [string]$a.name; $path = [string]$a.path
      if ($name -notmatch '^[A-Za-z0-9 ._+()-]{1,60}$') { throw 'invalid name' }
      if ([bool]$a.on) {
        if ($path -notmatch '^[A-Za-z]:\\[^"<>|]+\.exe$' -or -not (Test-Path -LiteralPath $path)) { throw 'invalid program path' }
        Set-ItemProperty -Path $key -Name $name -Value ('"' + $path + '"')
        return @{ ok = $true; removed = 0 }
      }
      $props = Get-ItemProperty -Path $key -ErrorAction SilentlyContinue
      $hits = @(if ($props) { $props.PSObject.Properties | Where-Object { $_.Name -notlike 'PS*' -and ($_.Name -eq $name -or ($path -and ([string]$_.Value).ToLower().Contains($path.ToLower()))) } })
      foreach ($h in $hits) { Remove-ItemProperty -Path $key -Name $h.Name }
      return @{ ok = $true; removed = $hits.Count }
    }
    'media.timeline' {
      $session = Get-MediaSession
      if (-not $session) { return @{ available = $false } }
      $tl = $session.GetTimelineProperties()
      return @{ available = $true; positionSec = [math]::Round($tl.Position.TotalSeconds, 1); endSec = [math]::Round($tl.EndTime.TotalSeconds, 1); status = $session.GetPlaybackInfo().PlaybackStatus.ToString() }
    }
    'diag' { return Invoke-Diag ([string]$a.metric) }
    'window.minimizeAll' { (New-Object -ComObject Shell.Application).MinimizeAll(); return @{ ok = $true } }
    'window.restoreAll' { (New-Object -ComObject Shell.Application).UndoMinimizeALL(); return @{ ok = $true } }
    'power.status' {
      $p = [System.Windows.Forms.SystemInformation]::PowerStatus
      return @{ percent = [math]::Round($p.BatteryLifePercent * 100); charging = ($p.PowerLineStatus.ToString() -eq 'Online'); status = $p.BatteryChargeStatus.ToString(); remainingSec = $p.BatteryLifeRemaining }
    }
    'session.lock' { return @{ ok = [ClickyyBridge.Win]::LockWorkStation() } }
    'keys.send' {
      $spec = [string]$a.spec
      if ($AllowedKeySpecs -notcontains $spec) { throw 'key combination not allowed' }
      [System.Windows.Forms.SendKeys]::SendWait($spec)
      return @{ ok = $true }
    }
    'keys.type' {
      $text = [string]$a.text
      if ($text.Length -gt 2000) { throw 'text too long' }
      [System.Windows.Forms.SendKeys]::SendWait((Escape-SendKeys $text))
      return @{ ok = $true; length = $text.Length }
    }
    'clipboard.set' { [System.Windows.Forms.Clipboard]::SetText([string]$a.text); return @{ ok = $true } }
    'clipboard.get' { return @{ text = [System.Windows.Forms.Clipboard]::GetText() } }
    'process.top' {
      return @(Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First ([int][math]::Min(30, [math]::Max(1, [int]$a.limit))) |
          ForEach-Object { @{ name = $_.ProcessName; pid = $_.Id; memMB = [math]::Round($_.WorkingSet64 / 1MB); title = $_.MainWindowTitle } })
    }
    default { throw "unknown op" }
  }
}

[Console]::Out.WriteLine('{"id":0,"ok":true,"result":{"ready":true}}')
[Console]::Out.Flush()
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $id = 0
  try {
    $req = $line | ConvertFrom-Json
    $id = [int]$req.id
    $result = Invoke-Op ([string]$req.op) $req.args
    $out = @{ id = $id; ok = $true; result = $result }
  } catch {
    $out = @{ id = $id; ok = $false; error = $_.Exception.Message }
  }
  [Console]::Out.WriteLine(($out | ConvertTo-Json -Compress -Depth 6))
  [Console]::Out.Flush()
}

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

  public static class Audio {
    static IMMDevice Device(int flow) {
      var en = (IMMDeviceEnumerator)new MMDeviceEnumeratorCom();
      IMMDevice dev;
      Marshal.ThrowExceptionForHR(en.GetDefaultAudioEndpoint(flow, 1, out dev));
      return dev;
    }
    static IAudioEndpointVolume Endpoint() {
      var iid = typeof(IAudioEndpointVolume).GUID;
      object o;
      Marshal.ThrowExceptionForHR(Device(0).Activate(ref iid, 23, IntPtr.Zero, out o));
      return (IAudioEndpointVolume)o;
    }
    public static int GetVolume() { float l; Marshal.ThrowExceptionForHR(Endpoint().GetMasterVolumeLevelScalar(out l)); return (int)Math.Round(l * 100); }
    public static void SetVolume(int pct) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMasterVolumeLevelScalar(Math.Max(0, Math.Min(100, pct)) / 100f, ref g)); }
    public static bool GetMute() { bool m; Marshal.ThrowExceptionForHR(Endpoint().GetMute(out m)); return m; }
    public static void SetMute(bool m) { var g = Guid.Empty; Marshal.ThrowExceptionForHR(Endpoint().SetMute(m, ref g)); }
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
        default { throw 'unknown window action' }
      }
    }
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

# prove_render.ps1: capture ONE window, the one owned by the given process, with PrintWindow (the window renders itself
# into our bitmap, PW_RENDERFULLCONTENT). It never reads screen pixels: a CopyFromScreen of a background window captures
# whatever else is on the screen there (D168, B's first attempt), and that is exactly what this must never do.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prove_render.ps1 -ProcId <pid> -Out <file.png>
#       [-Rect "x,y,w,h"]      a rectangle in CLIENT pixels (e.g. the preview canvas), to count pixels in
#       [-Bg "18,20,26"]       the preview's clear colour; a pixel farther than 12 (sum of |dRGB|) from it counts as drawn
#
# Prints one JSON line: { ok, hwnd, title, width, height, clientX, clientY, drawn, rectPixels, reason }.
# If the process has no top-level window, or it is minimised, nothing is written and ok is false.
param([Parameter(Mandatory = $true)][int]$ProcId, [Parameter(Mandatory = $true)][string]$Out, [string]$Rect = "", [string]$Bg = "18,20,26")
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class PW {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc f, IntPtr l);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint cmd);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h, ref POINT p);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr h, IntPtr dc, uint flags);
  public static IntPtr Find(uint want) {
    IntPtr found = IntPtr.Zero;
    EnumWindows((h, l) => { uint pid; GetWindowThreadProcessId(h, out pid);
      if (pid == want && IsWindowVisible(h) && GetWindow(h, 4) == IntPtr.Zero) { var s = new StringBuilder(256); GetWindowText(h, s, 256); if (s.Length > 0) { found = h; return false; } }
      return true; }, IntPtr.Zero);
    return found;
  }
}
"@
function Say($o) { $o | ConvertTo-Json -Compress; exit 0 }
$h = [PW]::Find([uint32]$ProcId)
if ($h -eq [IntPtr]::Zero) { Say @{ ok = $false; reason = "process $ProcId has no visible top-level window" } }
if ([PW]::IsIconic($h)) { Say @{ ok = $false; reason = 'the window is minimised; PrintWindow would return nothing useful' } }
$sb = New-Object System.Text.StringBuilder 256; [void][PW]::GetWindowText($h, $sb, 256)
$r = New-Object PW+RECT; [void][PW]::GetWindowRect($h, [ref]$r)
$w = $r.R - $r.L; $ht = $r.B - $r.T
$pt = New-Object PW+POINT; [void][PW]::ClientToScreen($h, [ref]$pt)
$cx = $pt.X - $r.L; $cy = $pt.Y - $r.T
$bmp = New-Object System.Drawing.Bitmap $w, $ht
$g = [System.Drawing.Graphics]::FromImage($bmp); $dc = $g.GetHdc()
$ok = [PW]::PrintWindow($h, $dc, 2)        # 2 = PW_RENDERFULLCONTENT: DirectComposition content (the WebView) included
$g.ReleaseHdc($dc); $g.Dispose()
if (-not $ok) { $bmp.Dispose(); Say @{ ok = $false; reason = 'PrintWindow returned false' } }
$drawn = $null; $n = 0
if ($Rect -ne "") {
  $q = $Rect.Split(',') | ForEach-Object { [int]$_ }; $b = $Bg.Split(',') | ForEach-Object { [int]$_ }
  $x0 = [Math]::Max(0, $cx + $q[0]); $y0 = [Math]::Max(0, $cy + $q[1]); $x1 = [Math]::Min($w, $x0 + $q[2]); $y1 = [Math]::Min($ht, $y0 + $q[3])
  $drawn = 0
  for ($y = $y0; $y -lt $y1; $y += 2) { for ($x = $x0; $x -lt $x1; $x += 2) {
    $c = $bmp.GetPixel($x, $y); $n++
    if ([Math]::Abs($c.R - $b[0]) + [Math]::Abs($c.G - $b[1]) + [Math]::Abs($c.B - $b[2]) -gt 12) { $drawn++ } } }
}
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png); $bmp.Dispose()
Say @{ ok = $true; hwnd = $h.ToInt64(); title = $sb.ToString(); width = $w; height = $ht; clientX = $cx; clientY = $cy; drawn = $drawn; rectPixels = $n }

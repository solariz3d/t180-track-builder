# install-local.ps1: install a local build of the track builder on this machine, one install at a time (D418 part 4; from the D414 rolling build's install
# and stamped compare). It never closes the builder: while one is open it waits, and gives up only after -WaitSec. Then it backs the installed exe up as
# .before-<Tag> (refusing if that backup exists), runs the installer silently with a hidden window, and checks the installed exe is the built exe with
# only the bundle-type stamp the installer writes (the 3 bytes after __TAURI_BUNDLE_TYPE_VAR_ go from UNK to NSS). Prints the installed exe's sha256.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/install-local.ps1 -Tag <name>
#       [-Installer <setup.exe>]  default: the newest *_x64-setup.exe in src-tauri/target/release/bundle/nsis
#       [-Built <exe>]            default: src-tauri/target/release/t180-track-builder.exe (the exe the installer was made from)
#       [-InstallDir <folder>]    default: %LOCALAPPDATA%\T-180 Track Builder
#       [-WaitSec 3600]           how long to wait for the builder to close, and for the install lock
#       [-Token <t>]              install under a lock already taken with -Take (the merge, build, install sequence)
#   ... -Take [-Tag <name>]       take the install lock, print its token, exit (the lock names the calling shell's process as its holder)
#   ... -Release -Token <t>       release the install lock taken with -Take
#
# The install lock is a file (default %LOCALAPPDATA%\t180-install.lock, or $env:T180_INSTALL_LOCK) holding the holder's pid, its start time and a token.
# A lock whose holder process is gone is stale and is taken over. It is not the heavy-run lock: an install is not a heavy run.
# Exit codes: 0 done; 2 bad arguments or missing files; 3 the builder stayed open; 4 the lock stayed held; 5 the backup exists; 6 the installer failed;
# 7 the stamped compare failed (the installed exe is NOT the built one); 8 the token does not hold the lock.
param([string]$Tag = '', [string]$Installer = '', [string]$Built = '', [string]$InstallDir = '', [int]$WaitSec = 3600, [string]$Token = '',
  [switch]$Take, [switch]$Release, [string]$ProcessName = 't180-track-builder', [int]$PollSec = 5)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$lockPath = if ($env:T180_INSTALL_LOCK) { $env:T180_INSTALL_LOCK } else { Join-Path $env:LOCALAPPDATA 't180-install.lock' }
# messages go to the host, never to the output stream: inside a function that returns a value (Take-Lock), Write-Output would become part of the value
function Fail([int]$code, [string]$msg) { Write-Host "STOP: $msg"; exit $code }
function Say([string]$msg) { Write-Host $msg }

function Read-Lock {
  if (-not (Test-Path -LiteralPath $lockPath)) { return $null }
  try { return Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json } catch { return $null }   # half-written: read again next poll
}
function Lock-Alive($l) {
  if ($null -eq $l) { return $false }
  $p = Get-Process -Id $l.pid -ErrorAction SilentlyContinue
  return ($null -ne $p) -and ($p.StartTime.ToUniversalTime().ToString('o') -eq $l.pidStarted)
}
function Take-Lock([int]$holderPid, [string]$what) {
  $hp = Get-Process -Id $holderPid
  $t = [guid]::NewGuid().ToString()
  $body = @{ pid = $holderPid; pidStarted = $hp.StartTime.ToUniversalTime().ToString('o'); token = $t; tag = $what; started = (Get-Date).ToUniversalTime().ToString('o') } | ConvertTo-Json -Compress
  $deadline = (Get-Date).AddSeconds($WaitSec); $said = $false
  while ($true) {
    try {
      $fs = [IO.File]::Open($lockPath, [IO.FileMode]::CreateNew, [IO.FileAccess]::Write, [IO.FileShare]::None)   # atomic: fails if the file exists
      $b = [Text.Encoding]::UTF8.GetBytes($body); $fs.Write($b, 0, $b.Length); $fs.Close()
      return $t
    } catch [IO.IOException] {
      $l = Read-Lock
      if ($null -ne $l -and -not (Lock-Alive $l)) { Say "install lock: its holder (pid $($l.pid), $($l.tag)) is gone; taking it over"; Remove-Item -LiteralPath $lockPath -Force; continue }
      if (-not $said) { Say "install lock: held by pid $($l.pid) ($($l.tag), since $($l.started)); waiting"; $said = $true }
      if ((Get-Date) -gt $deadline) { Fail 4 "the install lock stayed held for $WaitSec s; nothing was installed" }
      Start-Sleep -Seconds $PollSec
    }
  }
}
function Release-Lock([string]$t) {
  $l = Read-Lock
  if ($null -eq $l -or $l.token -ne $t) { Fail 8 "that token does not hold the install lock" }
  Remove-Item -LiteralPath $lockPath -Force
}

if ($Take) {
  $parent = (Get-CimInstance Win32_Process -Filter "ProcessId=$PID").ParentProcessId
  $t = Take-Lock $parent ($(if ($Tag) { $Tag } else { 'held for a merge' }))
  Write-Output $t; exit 0   # the token is the one thing on the output stream
}
if ($Release) { if (-not $Token) { Fail 2 "-Release needs -Token" }; Release-Lock $Token; Say "install lock released"; exit 0 }

if (-not $Tag -or $Tag -notmatch '^[A-Za-z0-9._-]+$') { Fail 2 "-Tag is required: letters, digits, '.', '_' or '-'" }
if (-not $InstallDir) { $InstallDir = Join-Path $env:LOCALAPPDATA 'T-180 Track Builder' }
if (-not $Built) { $Built = Join-Path $repo 'src-tauri\target\release\t180-track-builder.exe' }
if (-not $Installer) {
  $nsis = Join-Path $repo 'src-tauri\target\release\bundle\nsis'
  $found = @(Get-ChildItem -LiteralPath $nsis -Filter '*_x64-setup.exe' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($found.Count -eq 0) { Fail 2 "no installer in $nsis; build first, or pass -Installer" }
  $Installer = $found[0].FullName
}
$exe = Join-Path $InstallDir "$ProcessName.exe"; $bak = "$exe.before-$Tag"
foreach ($f in @($Installer, $Built, $exe)) { if (-not (Test-Path -LiteralPath $f -PathType Leaf)) { Fail 2 "no file at $f" } }

# the stamp the installer is expected to write, worked out before anything changes
$bytes = [IO.File]::ReadAllBytes($Built)
$latin = [Text.Encoding]::GetEncoding(28591).GetString($bytes)
$marker = '__TAURI_BUNDLE_TYPE_VAR_UNK'
$at = $latin.IndexOf($marker, [StringComparison]::Ordinal)
if ($at -lt 0 -or $latin.IndexOf($marker, $at + 1, [StringComparison]::Ordinal) -ge 0) { Fail 2 "the built exe must hold $marker exactly once" }
$stampAt = $at + $marker.Length - 3
$stamped = [byte[]]$bytes.Clone(); [Text.Encoding]::ASCII.GetBytes('NSS').CopyTo($stamped, $stampAt)
$sha = [Security.Cryptography.SHA256]::Create()
$want = -join ($sha.ComputeHash($stamped) | ForEach-Object { $_.ToString('X2') })
Say "installer: $Installer"
Say "built: $Built sha256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $Built).Hash); stamped at byte $stampAt, expected installed sha256 $want"

$own = $false
if ($Token) { $l = Read-Lock; if ($null -eq $l -or $l.token -ne $Token) { Fail 8 "that token does not hold the install lock" } }
else { $Token = Take-Lock $PID "install $Tag"; $own = $true }
try {
  $deadline = (Get-Date).AddSeconds($WaitSec); $said = $false
  while ($true) {
    $n = @(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue).Count
    if ($n -eq 0) { break }
    if (-not $said) { Say "the builder is open ($n process(es)); waiting for it to close (it is never closed here)"; $said = $true }
    if ((Get-Date) -gt $deadline) { Fail 3 "the builder stayed open for $WaitSec s; nothing was installed" }
    Start-Sleep -Seconds $PollSec
  }
  Say "builder processes before: 0"
  if (Test-Path -LiteralPath $bak) { Fail 5 "the backup $bak exists already; pick another -Tag" }
  Copy-Item -LiteralPath $exe -Destination $bak
  Say "backup: $bak sha256 $((Get-FileHash -Algorithm SHA256 -LiteralPath $bak).Hash)"
  $p = Start-Process -FilePath $Installer -ArgumentList '/S' -WindowStyle Hidden -Wait -PassThru
  if ($p.ExitCode -ne 0) { Fail 6 "the installer exited $($p.ExitCode); the backup is $bak" }
  $got = (Get-FileHash -Algorithm SHA256 -LiteralPath $exe).Hash
  $v = (Get-Item -LiteralPath $exe).VersionInfo.ProductVersion
  Say "installed: $exe sha256 $got, ProductVersion $v, $((Get-Item -LiteralPath $exe).Length) B"
  Say "builder processes after: $(@(Get-Process -Name $ProcessName -ErrorAction SilentlyContinue).Count)"
  if ($got -ne $want) { Fail 7 "the installed exe is not the built exe with the NSS stamp (expected $want); the backup is $bak" }
  Say "stamped compare: equal (the built exe with UNK -> NSS at byte $stampAt is the installed exe)"
} finally {
  if ($own) { $l = Read-Lock; if ($null -ne $l -and $l.token -eq $Token) { Remove-Item -LiteralPath $lockPath -Force } }
}

# prove_render_dialog.ps1: answer the app's own "Export the track into…" folder dialog, for the full-flow window proof
# (scripts/prove_render.js --flow). The dialog is native, so the DevTools protocol cannot reach it, and Tauri's JS
# objects are frozen, so it cannot be stood in for from the page. This finds a dialog window (class #32770) OWNED BY
# THE GIVEN PROCESS ONLY, types the folder into its folder box with UI Automation, and presses its Select Folder button.
# No other window is touched. Prints one JSON line: { ok, reason?, title?, buttons? }.
#
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/prove_render_dialog.ps1 -ProcId <pid> -Dir <folder> [-TimeoutSec 30]
param([Parameter(Mandatory = $true)][int]$ProcId, [Parameter(Mandatory = $true)][string]$Dir, [int]$TimeoutSec = 30)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
function Say($o) { $o | ConvertTo-Json -Compress; exit 0 }
if (-not (Test-Path -LiteralPath $Dir -PathType Container)) { Say @{ ok = $false; reason = "no folder $Dir" } }
$A = [System.Windows.Automation.AutomationElement]; $T = [System.Windows.Automation.TreeScope]; $P = [System.Windows.Automation.ControlType]
$byPid = New-Object System.Windows.Automation.PropertyCondition($A::ProcessIdProperty, $ProcId)
$isDlg = New-Object System.Windows.Automation.PropertyCondition($A::ClassNameProperty, '#32770')
$cond = New-Object System.Windows.Automation.AndCondition($byPid, $isDlg)
$end = (Get-Date).AddSeconds($TimeoutSec); $dlg = $null
while (-not $dlg -and (Get-Date) -lt $end) {
  # the dialog is a top-level window, or a child of the app's window; search both, always filtered by OUR process id
  $dlg = $A::RootElement.FindFirst($T::Children, $cond)
  if (-not $dlg) { $dlg = $A::RootElement.FindFirst($T::Descendants, $cond) }
  if (-not $dlg) { Start-Sleep -Milliseconds 250 }
}
if (-not $dlg) { Say @{ ok = $false; reason = "no dialog of process $ProcId within $TimeoutSec s" } }
if ($dlg.Current.ProcessId -ne $ProcId) { Say @{ ok = $false; reason = 'the dialog found is not ours; not touched' } }
$edits = $dlg.FindAll($T::Descendants, (New-Object System.Windows.Automation.PropertyCondition($A::ControlTypeProperty, $P::Edit)))
$box = $null
foreach ($e in $edits) { if ($e.Current.Name -match '^Folder') { $box = $e; break } }
if (-not $box -and $edits.Count -gt 0) { $box = $edits[$edits.Count - 1] }
if (-not $box) { Say @{ ok = $false; reason = 'no folder box in the dialog' } }
$box.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($Dir)
$all = @($dlg.FindAll($T::Descendants, [System.Windows.Automation.Condition]::TrueCondition))
$btns = @($all | Where-Object { $_.Current.ControlType -eq $P::Button -or $_.Current.ControlType -eq $P::SplitButton })
$go = $null
foreach ($b in $btns) {
  $n = $b.Current.Name.Trim()
  if ($n -eq 'Select Folder' -or $n -eq 'Select folder' -or $n -eq 'OK' -or $n -eq 'Open') { $go = $b; break }
}
if (-not $go) {
  $names = ($btns | ForEach-Object { $_.Current.ControlType.ProgrammaticName + ':' + $_.Current.Name }) -join ' | '
  Say @{ ok = $false; reason = 'no Select Folder button'; buttons = $names; title = $dlg.Current.Name }
}
$go.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
Say @{ ok = $true; title = $dlg.Current.Name; box = $box.Current.Name; button = $go.Current.Name }

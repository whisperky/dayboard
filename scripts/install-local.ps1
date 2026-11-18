$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe | Select-Object -First 1).Source
$server = Join-Path $PSScriptRoot 'serve-local.mjs'
$taskName = 'Dayboard localhost'

if (-not (Test-Path -LiteralPath (Join-Path $root 'dist/index.html'))) {
  throw 'Run npm run build in the Dayboard folder first.'
}

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$powerShell = Join-Path $env:SystemRoot 'System32/WindowsPowerShell/v1.0/powershell.exe'
$nodeArg = $node.Replace("'", "''")
$serverArg = $server.Replace("'", "''")
$command = "& '$nodeArg' '$serverArg'; exit `$LASTEXITCODE"
$action = New-ScheduledTaskAction -Execute $powerShell -WorkingDirectory $root -Argument (
  '-NoProfile -NonInteractive -WindowStyle Hidden -Command "' + $command + '"'
)
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
$listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
  if ($owner.Name -eq 'node.exe' -and $owner.CommandLine -match [regex]::Escape($server)) {
    if ($existing.State -eq 'Running') {
      Write-Output 'Dayboard address: http://dayboard.localhost:8080/'
      return
    }
    Stop-Process -Id $owner.ProcessId
  } else {
    throw 'Port 8080 is already in use by another process.'
  }
}
if ($existing.State -eq 'Running') {
  Stop-ScheduledTask -TaskName $taskName
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'Dayboard address: http://dayboard.localhost:8080/'

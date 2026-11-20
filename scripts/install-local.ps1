param([switch]$ShareWithTalentee)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$node = (Get-Command node.exe | Select-Object -First 1).Source
$server = Join-Path $PSScriptRoot 'serve-local.mjs'
$launcher = Join-Path $PSScriptRoot 'launch-local.vbs'
$taskName = 'Dayboard localhost'

if (-not (Test-Path -LiteralPath (Join-Path $root 'dist/index.html'))) {
  throw 'Run npm run build in the Dayboard folder first.'
}

$user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if (-not $PSBoundParameters.ContainsKey('ShareWithTalentee')) {
  $ShareWithTalentee = $existing.Actions.Arguments -match '(?:^| )--share-with-talentee(?: |$)'
}
$wscript = Join-Path $env:SystemRoot 'System32/wscript.exe'
$arguments = '//B //NoLogo "{0}" "{1}" "{2}"' -f $launcher, $node, $server
if ($ShareWithTalentee) { $arguments += ' --share-with-talentee' }
$action = New-ScheduledTaskAction -Execute $wscript -WorkingDirectory $root -Argument $arguments
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries

$bindings = @(
  @{ Address = '127.0.0.1'; Port = 8080 },
  @{ Address = '127.0.0.1'; Port = 80 },
  @{ Address = '::1'; Port = 80 }
)
$previous = foreach ($binding in $bindings) {
  foreach ($listener in (Get-NetTCPConnection -LocalAddress $binding.Address -LocalPort $binding.Port -State Listen -ErrorAction SilentlyContinue)) {
    $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $listener.OwningProcess)
    if ($owner.Name -ne 'node.exe' -or $owner.CommandLine -notmatch [regex]::Escape($server)) {
      throw ('{0} port {1} is already in use by another process.' -f $binding.Address, $binding.Port)
    }
    $owner.ProcessId
  }
}
if ($existing.State -eq 'Running') {
  Stop-ScheduledTask -TaskName $taskName
}
foreach ($processId in ($previous | Sort-Object -Unique)) {
  $owner = Get-CimInstance Win32_Process -Filter ('ProcessId=' + $processId)
  if ($owner.Name -eq 'node.exe' -and $owner.CommandLine -match [regex]::Escape($server)) {
    Stop-Process -Id $processId
  }
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

for ($attempt = 0; $attempt -lt 20; $attempt++) {
  $page = & curl.exe --noproxy '*' --max-time 1 --fail --silent 'http://dayboard.localhost/'
  if ($LASTEXITCODE -eq 0 -and $page -match '<title>Dayboard</title>') {
    Write-Output 'Dayboard address: http://dayboard.localhost/'
    return
  }
  Start-Sleep -Milliseconds 250
}
throw 'Dayboard did not respond on the local domain. Check the Dayboard localhost task in Task Scheduler.'

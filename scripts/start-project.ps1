[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet("test", "production")]
  [string]$Mode
)

$ErrorActionPreference = "Stop"
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$serverScript = Join-Path $projectRoot "apps\user_client\server.mjs"
$apiScript = Join-Path $projectRoot "services\api\src\server.ts"

Set-Location $projectRoot

if ($Mode -eq "production") {
  $productionEnvFile = Join-Path $projectRoot ".env.production"
  if ([string]::IsNullOrWhiteSpace($env:SUPABASE_DATABASE_URL) -and -not (Test-Path -LiteralPath $productionEnvFile)) {
    throw "Production startup requires SUPABASE_DATABASE_URL or .env.production."
  }
}

function Get-DescendantProcessIds {
  param(
    [int]$ParentId,
    [object[]]$AllProcesses
  )

  foreach ($child in @($AllProcesses | Where-Object { [int]$_.ParentProcessId -eq $ParentId })) {
    [int]$child.ProcessId
    Get-DescendantProcessIds -ParentId ([int]$child.ProcessId) -AllProcesses $AllProcesses
  }
}

function Stop-PreviousProjectProcesses {
  $allProcesses = @(Get-CimInstance Win32_Process)
  $markers = @(
    [IO.Path]::GetFullPath($serverScript),
    [IO.Path]::GetFullPath($apiScript),
    "apps/user_client/server.mjs",
    "apps\user_client\server.mjs",
    "services/api/src/server.ts",
    "services\api\src\server.ts"
  )
  $matches = @(
    $allProcesses | Where-Object {
      $commandLine = [string]$_.CommandLine
      $commandLine -and @($markers | Where-Object { $commandLine.IndexOf($_, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count -gt 0
    }
  )
  if ($matches.Count -eq 0) {
    Write-Host "No previous Lijing process found."
    return
  }

  $ids = New-Object "System.Collections.Generic.HashSet[int]"
  foreach ($match in $matches) {
    [void]$ids.Add([int]$match.ProcessId)
    foreach ($childId in @(Get-DescendantProcessIds -ParentId ([int]$match.ProcessId) -AllProcesses $allProcesses)) {
      [void]$ids.Add([int]$childId)
    }
  }

  foreach ($id in $ids) {
    if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
      Stop-Process -Id $id -Force -ErrorAction SilentlyContinue
      Write-Host "Stopped previous Lijing process PID $id."
    }
  }
  Start-Sleep -Milliseconds 400
}

Stop-PreviousProjectProcesses

if ([string]::IsNullOrWhiteSpace($env:HOST)) { $env:HOST = "127.0.0.1" }
if ([string]::IsNullOrWhiteSpace($env:PORT)) { $env:PORT = "4187" }
$node = (Get-Command node.exe -ErrorAction Stop).Source

if ($Mode -eq "test") {
  $env:APP_ENV = "local"
  $env:NODE_ENV = "development"
  Write-Host "Starting Lijing in test mode at http://$($env:HOST):$($env:PORT)"
  & $node --env-file-if-exists=.env.local --env-file-if-exists=.env.ai.local --watch --no-warnings $serverScript
  exit $LASTEXITCODE
}

$env:APP_ENV = "production"
$env:NODE_ENV = "production"
Write-Host "Starting Lijing in production mode at http://$($env:HOST):$($env:PORT)"
& $node --env-file-if-exists=.env.production --no-warnings $serverScript
exit $LASTEXITCODE

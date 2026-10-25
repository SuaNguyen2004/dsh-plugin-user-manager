# scripts/cleanup-test.ps1
# Safe sweeper for test containers and volumes.
#
# Strict deletion policy (BOTH conditions MUST match):
#   1. Docker label `dsh.managed=true` is present.
#   2. Resource name starts with the prefix `test-` (or `dsh-tool-test-`).
#
# Hard deny-list (NEVER deleted under any flag or condition):
#   - dsh-vol-user*       (all user workspace volumes)
#   - dsh-vol-admin*      (admin workspace volume)
#   - dsh-homes*          (shared DSH homes volume)
#   - dsh-gateway-data*   (gateway SQLite volume)
#   - dsh-enterprise*     (compose resources)
#
# Usage:
#   powershell -File scripts/cleanup-test.ps1 -DryRun   # preview only
#   powershell -File scripts/cleanup-test.ps1           # execute cleanup

param(
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"

function Test-IsProtectedName([string]$Name) {
    if ($Name -like "dsh-vol-user*")     { return $true }
    if ($Name -like "dsh-vol-admin*")    { return $true }
    if ($Name -like "dsh-homes*")        { return $true }
    if ($Name -like "dsh-gateway-data*") { return $true }
    if ($Name -like "dsh-enterprise*")   { return $true }
    return $false
}

function Test-HasTestPrefix([string]$Name) {
    return ($Name -like "test-*") -or ($Name -like "dsh-tool-test-*")
}

Write-Host "=== DSH TEST CLEANUP (DryRun=$DryRun) ===" -ForegroundColor Cyan

# ---------- 1. Containers with label dsh.managed=true ----------
$containerIds = docker ps -a -q --filter "label=dsh.managed=true"
foreach ($cid in $containerIds) {
    if (-not $cid) { continue }
    $rawName = (docker inspect -f '{{.Name}}' $cid).Trim()
    $name = $rawName.TrimStart('/')

    if (Test-IsProtectedName $name) {
        Write-Host "[PROTECTED] container $name" -ForegroundColor DarkGray
        continue
    }

    if (Test-HasTestPrefix $name) {
        if ($DryRun) {
            Write-Host "[DRY-RUN] Would remove container: $name ($cid)" -ForegroundColor Yellow
        } else {
            docker rm -f $name | Out-Null
            Write-Host "[REMOVED] container: $name" -ForegroundColor Green
        }
    } else {
        Write-Host "[SKIP] container $name (does not start with test-)" -ForegroundColor DarkGray
    }
}

# ---------- 2. Volumes with label dsh.managed=true ----------
$volumeNames = docker volume ls -q --filter "label=dsh.managed=true"
foreach ($vname in $volumeNames) {
    if (-not $vname) { continue }
    $vname = $vname.Trim()

    # Absolute protection: NEVER touch dsh-vol-user*, dsh-homes*, etc.
    if (Test-IsProtectedName $vname) {
        Write-Host "[PROTECTED] volume $vname (never delete)" -ForegroundColor DarkGray
        continue
    }

    if ($vname -like "test-*") {
        if ($DryRun) {
            Write-Host "[DRY-RUN] Would remove volume: $vname" -ForegroundColor Yellow
        } else {
            docker volume rm $vname | Out-Null
            Write-Host "[REMOVED] volume: $vname" -ForegroundColor Green
        }
    } else {
        Write-Host "[SKIP] volume $vname (does not start with test-)" -ForegroundColor DarkGray
    }
}

Write-Host "=== DONE ===" -ForegroundColor Cyan

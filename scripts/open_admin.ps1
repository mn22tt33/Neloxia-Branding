$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDirectory = Join-Path $projectRoot ".local-run"
$statePath = Join-Path $runtimeDirectory "state.json"
$ports = 8700..8705
$port = $null
$serverProcess = $null
$startedHere = $false

function Test-LocalHealth {
    param([int]$Port)

    try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 10
        return [bool]$health.ok
    } catch {
        return $false
    }
}

foreach ($candidate in $ports) {
    if (Test-LocalHealth $candidate) {
        $port = $candidate
        break
    }
}

if ($null -eq $port) {
    foreach ($candidate in $ports) {
        $listener = Get-NetTCPConnection -State Listen -LocalPort $candidate -ErrorAction SilentlyContinue
        if (-not $listener) {
            $port = $candidate
            break
        }
    }
    if ($null -eq $port) {
        throw "المنافذ المحلية من 8700 إلى 8705 مستخدمة؛ أوقف نسخة QUIZORA الحالية ثم أعد المحاولة."
    }

    $pythonCommand = Get-Command python.exe -ErrorAction Stop
    New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null
    $serverStdout = Join-Path $runtimeDirectory "admin-server.out.log"
    $serverStderr = Join-Path $runtimeDirectory "admin-server.err.log"
    $serverScript = Join-Path $projectRoot "backend\server.py"
    $previousPort = $env:PORT
    $previousNoBrowser = $env:TOOL_NO_BROWSER
    try {
        $env:PORT = [string]$port
        $env:TOOL_NO_BROWSER = "1"
        $serverProcess = Start-Process `
            -FilePath $pythonCommand.Source `
            -ArgumentList @("`"$serverScript`"") `
            -WorkingDirectory $projectRoot `
            -WindowStyle Hidden `
            -RedirectStandardOutput $serverStdout `
            -RedirectStandardError $serverStderr `
            -PassThru
    } finally {
        $env:PORT = $previousPort
        $env:TOOL_NO_BROWSER = $previousNoBrowser
    }

    $startedHere = $true
    try {
        $healthReady = $false
        $healthDeadline = (Get-Date).AddSeconds(90)
        while ((Get-Date) -lt $healthDeadline) {
            $serverProcess.Refresh()
            if ($serverProcess.HasExited) {
                throw "توقف الخادم أثناء بدء التشغيل. راجع السجل: $serverStderr"
            }
            if (Test-LocalHealth $port) {
                $healthReady = $true
                break
            }
            Start-Sleep -Seconds 1
        }
        if (-not $healthReady) {
            throw "لم يستجب الخادم المحلي خلال المهلة المحددة. راجع السجل: $serverStderr"
        }

        $state = [pscustomobject]@{
            serverPid = $serverProcess.Id
            tunnelPid = 0
            tunnelProvider = "local-admin"
            port = $port
            tunnelUrl = ""
            frontendReady = $false
            shareUrl = ""
        }
        $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8
    } catch {
        $serverProcess.Refresh()
        if (-not $serverProcess.HasExited) {
            Stop-Process -Id $serverProcess.Id -Force
        }
        throw
    }
}

$adminUrl = "http://127.0.0.1:$port/admin"
try {
    $page = Invoke-WebRequest -Uri $adminUrl -TimeoutSec 15 -UseBasicParsing
    if ($page.StatusCode -ne 200) {
        throw "استجاب الخادم، لكن لوحة الإدارة لم تفتح."
    }
} catch {
    if ($startedHere) {
        if ($serverProcess -and -not $serverProcess.HasExited) {
            Stop-Process -Id $serverProcess.Id -Force
        }
        if (Test-Path -LiteralPath $statePath) {
            Remove-Item -LiteralPath $statePath -Force
        }
        throw
    }
    throw "الخادم المحلي يعمل بنسخة قديمة أو غير متوافقة. بعد التأكد من عدم وجود حل جارٍ، أوقفها من STOP_QUIZORA.bat ثم افتح OPEN_ADMIN.bat مجددًا."
}

Start-Process $adminUrl
Write-Host "تم فتح لوحة الإدارة المحلية: $adminUrl"
if ($startedHere) {
    Write-Host "بدأت خدمة QUIZORA محليًا. استخدم STOP_QUIZORA.bat لإيقافها."
}

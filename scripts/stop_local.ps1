$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$statePath = Join-Path (Join-Path $projectRoot ".local-run") "state.json"

if (-not (Test-Path -LiteralPath $statePath)) {
    Write-Host "لا توجد جلسة تشغيل مُدارة لإيقافها."
    exit 0
}

$state = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
$targets = @(
    @{ ProcessId = [int]$state.tunnelPid; Kind = "tunnel" },
    @{ ProcessId = [int]$state.serverPid; Kind = "server" }
)

foreach ($target in $targets) {
    if ($target.ProcessId -le 0) {
        continue
    }

    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $($target.ProcessId)" -ErrorAction SilentlyContinue
    $matchesExpectedProcess = $false
    if ($processInfo -and $target.Kind -eq "tunnel") {
        $matchesExpectedProcess = (
            $processInfo.Name -eq "ngrok.exe" -and
            $processInfo.CommandLine -match "\bhttp\s+$([int]$state.port)(?:\s|$)"
        ) -or (
            $processInfo.Name -eq "cloudflared.exe" -and
            $processInfo.CommandLine -match "tunnel\s+--protocol\s+http2\s+--url\s+http://127\.0\.0\.1:$([int]$state.port)"
        )
    } elseif ($processInfo -and $target.Kind -eq "server") {
        $matchesExpectedProcess = $processInfo.Name -match "^python(w)?\.exe$" -and
            $processInfo.CommandLine -match "backend[\\/]server\.py"
    }

    if ($matchesExpectedProcess) {
        Stop-Process -Id $target.ProcessId -Force
        Write-Host "تم إيقاف $($target.Kind) (PID $($target.ProcessId))."
    } elseif ($processInfo) {
        Write-Warning "لم أوقف PID $($target.ProcessId) لأن العملية لا تطابق خدمة QUIZORA."
    } else {
        Write-Host "العملية $($target.Kind) متوقفة بالفعل."
    }
}

Remove-Item -LiteralPath $statePath -Force
Write-Host "تم إيقاف الخادم المحلي ونفق ngrok."

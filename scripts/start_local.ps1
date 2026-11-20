$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$runtimeDirectory = Join-Path $projectRoot ".local-run"
$statePath = Join-Path $runtimeDirectory "state.json"
$port = 8700
$serverProcess = $null
$tunnelProcess = $null
$configPath = Join-Path $projectRoot "frontend\config.js"
$configContent = Get-Content -LiteralPath $configPath -Raw
$apiUrlMatch = [regex]::Match(
    $configContent,
    'var\s+apiBaseUrl\s*=\s*"(?<url>https://[^"]+)"'
)
if (-not $apiUrlMatch.Success) {
    throw "تعذّر قراءة عنوان ngrok من frontend\config.js."
}
$apiUrl = $apiUrlMatch.Groups["url"].Value.TrimEnd("/")

New-Item -ItemType Directory -Path $runtimeDirectory -Force | Out-Null

function Get-ManagedProcess {
    param([int]$ProcessId)

    Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction SilentlyContinue
}

function Test-ManagedServer {
    param($ProcessInfo)

    return $ProcessInfo -and
        $ProcessInfo.Name -match "^python(w)?\.exe$" -and
        $ProcessInfo.CommandLine -match "backend[\\/]server\.py"
}

function Test-ManagedTunnel {
    param($ProcessInfo)

    if (-not $ProcessInfo) {
        return $false
    }

    if ($ProcessInfo.Name -eq "ngrok.exe") {
        return $ProcessInfo.CommandLine -match "\bhttp\s+$port(?:\s|$)"
    }

    return $ProcessInfo.Name -eq "cloudflared.exe" -and
        $ProcessInfo.CommandLine -match "tunnel\s+--protocol\s+http2\s+--url\s+http://127\.0\.0\.1:$port"
}

if (Test-Path -LiteralPath $statePath) {
    $previousState = Get-Content -LiteralPath $statePath -Raw | ConvertFrom-Json
    $previousServer = Get-ManagedProcess -ProcessId ([int]$previousState.serverPid)
    $previousTunnel = Get-ManagedProcess -ProcessId ([int]$previousState.tunnelPid)

    if (
        (Test-ManagedServer $previousServer) -and
        (Test-ManagedTunnel $previousTunnel) -and
        $previousState.tunnelProvider -eq "ngrok"
    ) {
        try {
            $deployedConfig = Invoke-WebRequest -Uri "https://quizora.movb.workers.dev/config.js" -TimeoutSec 10 -UseBasicParsing
            $previousState.frontendReady = $deployedConfig.Content -match [regex]::Escape($previousState.tunnelUrl)
        } catch {
            Write-Warning "تعذّر التحقق من إعداد الواجهة على Workers."
        }
        Write-Host "QUIZORA يعمل بالفعل."
        Write-Host "رابط الـAPI الثابت: $($previousState.tunnelUrl)"
        if ($previousState.frontendReady) {
            $shareUrl = "https://quizora.movb.workers.dev"
            Write-Host "رابط الموقع: $shareUrl"
            try {
                Set-Clipboard -Value $shareUrl
                Write-Host "تم نسخ رابط الموقع."
            } catch {
                Write-Warning "تعذّر نسخ الرابط تلقائيًا."
            }
        } else {
            Write-Warning "الواجهة المستضافة لسه محتاجة إعداد عنوان الـAPI الثابت."
        }
        exit 0
    }

    if (Test-ManagedTunnel $previousTunnel) {
        Stop-Process -Id ([int]$previousTunnel.ProcessId) -Force
    }
    if (Test-ManagedServer $previousServer) {
        Stop-Process -Id ([int]$previousServer.ProcessId) -Force
    }
    Remove-Item -LiteralPath $statePath -Force
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue
if ($listener) {
    throw "المنفذ $port مستخدم بالفعل. أوقف النسخة الحالية أولًا من ملف STOP_QUIZORA.bat."
}

$pythonCommand = Get-Command python.exe -ErrorAction Stop
$ngrokCommand = Get-Command ngrok.exe -ErrorAction SilentlyContinue
$ngrokPath = if ($ngrokCommand) { $ngrokCommand.Source } else { "" }
if (-not $ngrokPath) {
    $wingetLink = Join-Path $env:LOCALAPPDATA "Microsoft\WinGet\Links\ngrok.exe"
    if (Test-Path -LiteralPath $wingetLink) {
        $ngrokPath = $wingetLink
    }
}
if (-not $ngrokPath -or -not (Test-Path -LiteralPath $ngrokPath)) {
    throw "ngrok مش متثبت. ثبّته بالأمر: winget install --id Ngrok.Ngrok --exact، وبعدها ضيف مفتاح حسابك محليًا."
}

# أوقف عمليات ngrok أو الخادم اليتيمة التي تبقى بعد فقدان state.json،
# حتى لا يبقى سجل قديم مقفولًا ويمنع بدء التشغيل مرة أخرى.
$orphanProcesses = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    ($_.Name -eq "ngrok.exe" -and $_.CommandLine -match "\bhttp\s+$port(?:\s|$)") -or
    ($_.Name -eq "cloudflared.exe" -and $_.CommandLine -match "tunnel\s+--protocol\s+http2\s+--url\s+http://127\.0\.0\.1:$port") -or
    ($_.Name -match "^python(w)?\.exe$" -and $_.CommandLine -match "backend[\\/]server\.py")
}
foreach ($orphan in $orphanProcesses) {
    Stop-Process -Id $orphan.ProcessId -Force -ErrorAction SilentlyContinue
}
foreach ($orphan in $orphanProcesses) {
    Wait-Process -Id $orphan.ProcessId -Timeout 5 -ErrorAction SilentlyContinue
}

$runId = (Get-Date).ToString("yyyyMMdd-HHmmss")
$serverStdout = Join-Path $runtimeDirectory "server.$runId.out.log"
$serverStderr = Join-Path $runtimeDirectory "server.$runId.err.log"
$tunnelStdout = Join-Path $runtimeDirectory "tunnel.$runId.out.log"
$tunnelStderr = Join-Path $runtimeDirectory "tunnel.$runId.err.log"

try {
    $serverProcess = Start-Process `
        -FilePath $pythonCommand.Source `
        -ArgumentList "backend\server.py" `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $serverStdout `
        -RedirectStandardError $serverStderr `
        -PassThru

    $healthReady = $false
    $healthDeadline = (Get-Date).AddSeconds(90)
    while ((Get-Date) -lt $healthDeadline) {
        if ($serverProcess.HasExited) {
            throw "توقف الخادم أثناء بدء التشغيل. راجع السجل: $serverStderr"
        }
        try {
            $health = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/health" -TimeoutSec 10
            if ($health.ok) {
                $healthReady = $true
                break
            }
        } catch {
        }
        Start-Sleep -Seconds 1
    }
    if (-not $healthReady) {
        throw "لم يستجب الخادم المحلي خلال المهلة المحددة. راجع السجل: $serverStderr"
    }

    try {
        $localAuthStatus = Invoke-RestMethod `
            -Uri "http://127.0.0.1:$port/api/auth/status" `
            -TimeoutSec 10
    } catch {
        throw "تعذّر تشغيل الموقع. حاول مرة أخرى لاحقًا."
    }
    if (-not $localAuthStatus.enabled) {
        throw "تعذّر تشغيل الموقع. حاول مرة أخرى لاحقًا."
    }

    $tunnelProcess = Start-Process `
        -FilePath $ngrokPath `
        -ArgumentList @("http", "$port", "--url", $apiUrl) `
        -WorkingDirectory $projectRoot `
        -WindowStyle Hidden `
        -RedirectStandardOutput $tunnelStdout `
        -RedirectStandardError $tunnelStderr `
        -PassThru

    $publicUrl = ""
    # ngrok can take longer on the first connection while it negotiates the
    # reserved endpoint; keep the local server alive while that handshake completes.
    $tunnelDeadline = (Get-Date).AddSeconds(120)
    while ((Get-Date) -lt $tunnelDeadline) {
        if ($tunnelProcess.HasExited) {
            throw "ngrok وقف أثناء التشغيل. راجع السجل: $tunnelStderr، وتأكد إنك ضايف مفتاح حسابك."
        }
        try {
            $endpoints = Invoke-RestMethod -Uri "http://127.0.0.1:4040/api/endpoints" -TimeoutSec 2
            $endpoint = @($endpoints.endpoints | Where-Object {
                $_.upstream.url -match ":$port(?:$|/)" -and $_.url -match "^https://"
            } | Select-Object -First 1)
            if ($endpoint.Count -gt 0) {
                $publicUrl = $endpoint[0].url.TrimEnd("/")
                break
            }
        } catch {
        }
        Start-Sleep -Seconds 1
    }
    if (-not $publicUrl) {
        $tunnelLog = Get-Content -LiteralPath $tunnelStderr -Raw -ErrorAction SilentlyContinue
        throw "ngrok ماطلعش عنوان خلال المهلة. تأكد من إعداد الحساب ومفتاحه محليًا، وراجع السجل: $tunnelStderr`n$tunnelLog"
    }

    try {
        $publicHealth = Invoke-RestMethod `
            -Uri "$publicUrl/api/health" `
            -Headers @{ "ngrok-skip-browser-warning" = "true" } `
            -TimeoutSec 10
        if (-not $publicHealth.ok) {
            throw "فحص صحة الخادم العام لم ينجح."
        }
        $publicAuthStatus = Invoke-RestMethod `
            -Uri "$publicUrl/api/auth/status" `
            -Headers @{ "ngrok-skip-browser-warning" = "true" } `
            -TimeoutSec 10
        if (-not $publicAuthStatus.enabled) {
            throw "تعذّر تشغيل الموقع."
        }
    } catch {
        throw "تعذّر توصيل الموقع. أوقف أي تشغيل آخر وحاول مرة أخرى."
    }

    $shareUrl = ""
    $frontendReady = $false
    try {
        $deployedConfig = Invoke-WebRequest -Uri "https://quizora.movb.workers.dev/config.js" -TimeoutSec 10 -UseBasicParsing
        $frontendReady = $deployedConfig.Content -match [regex]::Escape($publicUrl)
    } catch {
        Write-Warning "تعذّر التحقق من إعداد الواجهة المستضافة."
    }
    if ($frontendReady) {
        $shareUrl = "https://quizora.movb.workers.dev"
    } else {
        Write-Warning "الواجهة المستضافة لسه مش متوصلة بعنوان ngrok الثابت. مش هنسخ رابط مشاركة غير جاهز."
    }

    $state = [pscustomobject]@{
        serverPid = $serverProcess.Id
        tunnelPid = $tunnelProcess.Id
        tunnelProvider = "ngrok"
        port = $port
        tunnelUrl = $publicUrl
        frontendReady = $frontendReady
        shareUrl = $shareUrl
    }
    $state | ConvertTo-Json | Set-Content -LiteralPath $statePath -Encoding UTF8

    Write-Host ""
    Write-Host ""
    Write-Host "QUIZORA is running locally."
    Write-Host "Local URL: http://127.0.0.1:$port"
    Write-Host "رابط الـAPI الثابت: $publicUrl"
    if ($shareUrl) {
        Write-Host "رابط الموقع الأساسي: $shareUrl"
        try {
            Set-Clipboard -Value $shareUrl
            Write-Host "تم نسخ رابط الموقع. تقدر تشاركه."
        } catch {
            Write-Warning "تعذّر نسخ الرابط تلقائيًا."
        }
    }
    Write-Host "عشان توقف الخادم والنفق، دوس مرتين على STOP_QUIZORA.bat."
} catch {
    if ($tunnelProcess -and -not $tunnelProcess.HasExited) {
        Stop-Process -Id $tunnelProcess.Id -Force
    }
    if ($serverProcess -and -not $serverProcess.HasExited) {
        Stop-Process -Id $serverProcess.Id -Force
    }
    if (Test-Path -LiteralPath $statePath) {
        Remove-Item -LiteralPath $statePath -Force
    }
    throw
}

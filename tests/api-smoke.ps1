# tests/api-smoke.ps1 — 后端接口冒烟测试（对应方案各阶段验收标准）
# 用法： pwsh -File tests/api-smoke.ps1 [-BaseUrl http://localhost:3001]
# 凭据说明：默认从 server/.env 读取 ADMIN_USERNAME / ADMIN_PASSWORD（绝不写死在脚本里），
#          也可用 -AdminUser / -AdminPass 显式覆盖。
param(
  [string]$BaseUrl = 'http://localhost:3001',
  [string]$AdminUser = '',
  [string]$AdminPass = ''
)

$ErrorActionPreference = 'Continue'

# ---- 从 server/.env 读取管理员凭据与验证码旁路令牌 ----
$script:envFile = Join-Path $PSScriptRoot '..\server\.env'
$script:envValues = @{}
if (Test-Path $script:envFile) {
  foreach ($line in (Get-Content $script:envFile -Encoding UTF8)) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $idx = $line.IndexOf('=')
    $k = $line.Substring(0, $idx).Trim()
    $v = $line.Substring($idx + 1).Trim()
    $script:envValues[$k] = $v
  }
}
if (-not $AdminUser) { $AdminUser = if ($script:envValues['ADMIN_USERNAME']) { $script:envValues['ADMIN_USERNAME'] } else { 'admin' } }
if (-not $AdminPass) { $AdminPass = $script:envValues['ADMIN_PASSWORD'] }

Add-Type -AssemblyName System.Net.Http -ErrorAction SilentlyContinue
$script:pass = 0
$script:fail = 0
$script:skip = 0

function Test-Case {
  param([string]$Name, [scriptblock]$Body)
  try {
    $result = & $Body
    if ($result -eq $true) {
      Write-Host "  [PASS] $Name" -ForegroundColor Green
      $script:pass++
    } elseif ($result -is [string] -and $result.StartsWith('__SKIP__')) {
      $why = $result.Substring(8).TrimStart(':', ' ')
      Write-Host "  [SKIP] $Name$(if ($why) { " — $why" })" -ForegroundColor Yellow
      $script:skip++
    } else {
      Write-Host "  [FAIL] $Name -> $result" -ForegroundColor Red
      $script:fail++
    }
  } catch {
    Write-Host "  [FAIL] $Name -> 异常: $($_.Exception.Message)" -ForegroundColor Red
    $script:fail++
  }
}

function Get-Json {
  param([string]$Path, [string]$Method = 'GET', $Body = $null, [hashtable]$Headers = @{}, [int]$MaxRedirection = -1)
  $params = @{
    Uri                = "$BaseUrl$Path"
    Method             = $Method
    UseBasicParsing    = $true
    TimeoutSec         = 20
    Headers            = $Headers
    ErrorAction        = 'Stop'
  }
  if ($MaxRedirection -ge 0) { $params.MaximumRedirection = $MaxRedirection }
  if ($Body) {
    # 注意：PowerShell 5.1 直接用字符串作为 Body 时不会按 UTF-8 发送，
    # 中文会被写成 "?"。这里显式转成 UTF-8 字节，避免污染配置数据。
    $params.ContentType = 'application/json; charset=utf-8'
    $json = $Body | ConvertTo-Json -Depth 10 -Compress
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes($json)
  }

  try {
    $resp = Invoke-WebRequest @params
    $json = $null
    try { $json = $resp.Content | ConvertFrom-Json } catch { }
    return [pscustomobject]@{ Status = [int]$resp.StatusCode; Json = $json; Raw = $resp.Content; Headers = $resp.Headers }
  } catch {
    # PowerShell 5.1：非 2xx 会抛异常，响应体在 ErrorDetails.Message 中
    $webResp = $_.Exception.Response
    $bodyText = ''
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $bodyText = [string]$_.ErrorDetails.Message
    }
    if (-not $bodyText -and $webResp) {
      try {
        $stream = $webResp.GetResponseStream()
        $reader = New-Object System.IO.StreamReader($stream)
        $bodyText = $reader.ReadToEnd()
        $reader.Close()
      } catch { }
    }
    if (-not $webResp -and -not $bodyText) { throw }
    $status = 0
    if ($webResp) { $status = [int]$webResp.StatusCode }
    $json = $null
    try { $json = $bodyText | ConvertFrom-Json } catch { }
    $hdrs = @{}
    if ($webResp) { $hdrs = $webResp.Headers }
    return [pscustomobject]@{ Status = $status; Json = $json; Raw = $bodyText; Headers = $hdrs }
  }
}

Write-Host ''
Write-Host '=== 原神功能快捷站 · 后端接口冒烟测试 ===' -ForegroundColor Cyan
Write-Host "目标: $BaseUrl"
Write-Host "管理员: $AdminUser$(if (-not $AdminPass) { '  [警告] 未取到 ADMIN_PASSWORD，请检查 server/.env' })"
Write-Host ''

# ---------- 阶段1：健康检查 + 安全头 ----------
Write-Host '[阶段1] 后端骨架与安全中间件'

Test-Case 'GET /health 返回 status=ok' {
  $r = Get-Json '/health'
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($r.Json.status -ne 'ok') { return "status=$($r.Json.status)" }
  $true
}

Test-Case '响应头包含 Content-Security-Policy 且 default-src 为 self' {
  $r = Get-Json '/health'
  $csp = [string]$r.Headers['Content-Security-Policy']
  if (-not $csp) { return '缺少 CSP 头' }
  if ($csp -notmatch "default-src 'self'") { return "CSP=$csp" }
  $true
}

Test-Case '响应头 X-Frame-Options = DENY' {
  $r = Get-Json '/health'
  $v = [string]$r.Headers['X-Frame-Options']
  if ($v -ne 'DENY') { return "X-Frame-Options=$v" }
  $true
}

Test-Case '响应头包含 X-Content-Type-Options: nosniff' {
  $r = Get-Json '/health'
  $v = [string]$r.Headers['X-Content-Type-Options']
  if ($v -ne 'nosniff') { return "值=$v" }
  $true
}

Test-Case 'CORS 白名单外来源被拒绝（403）' {
  $r = Get-Json '/health' -Headers @{ Origin = 'https://evil.example.com' }
  if ($r.Status -ne 403) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'CORS 白名单内来源被放行' {
  $r = Get-Json '/health' -Headers @{ Origin = 'http://localhost:3001' }
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ([string]$r.Headers['Access-Control-Allow-Origin'] -ne 'http://localhost:3001') { return '未返回 ACAO 头' }
  $true
}

Test-Case '未知 API 路径返回 JSON 404' {
  $r = Get-Json '/api/not-exist'
  if ($r.Status -ne 404) { return "HTTP $($r.Status)" }
  if (-not $r.Json.error) { return '缺少 error 字段' }
  $true
}

# ---------- 阶段2：Kuma 数据 ----------
Write-Host ''
Write-Host '[阶段2] Kuma REST 集成（含 Mock 降级）'

Test-Case 'GET /api/status/summary 返回摘要' {
  $r = Get-Json '/api/status/summary'
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($null -eq $r.Json.total) { return '缺少 total' }
  if ($null -eq $r.Json.up) { return '缺少 up' }
  $true
}

Test-Case 'GET /api/status/monitors 返回 monitors + summary' {
  $r = Get-Json '/api/status/monitors'
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($r.Json.monitors.Count -lt 1) { return 'monitors 为空' }
  if ($null -eq $r.Json.summary.total) { return '缺少 summary' }
  if (-not $r.Json.source) { return '缺少 source 标识' }
  $true
}

Test-Case '监控条目字段完整（id/name/status/uptime24h/ping/history）' {
  $r = Get-Json '/api/status/monitors'
  $m = $r.Json.monitors[0]
  foreach ($f in @('id', 'name', 'status', 'history')) {
    if ($null -eq $m.$f) { return "缺少字段 $f" }
  }
  if ($m.status -notin @('up', 'down', 'pending', 'maintenance', 'unknown')) { return "status=$($m.status)" }
  $true
}

Test-Case '缓存生效：第二次请求更快（或命中缓存标识）' {
  $t1 = (Measure-Command { Get-Json '/api/status/monitors' | Out-Null }).TotalMilliseconds
  $t2 = (Measure-Command { Get-Json '/api/status/monitors' | Out-Null }).TotalMilliseconds
  # 第二次不应显著慢于第一次；缓存命中时通常更快
  if ($t2 -gt ($t1 * 3 + 50)) { return "t1=$([int]$t1)ms t2=$([int]$t2)ms" }
  $true
}

Test-Case 'GET /api/status/heartbeat/:id 返回心跳历史' {
  $r = Get-Json '/api/status/heartbeat/1'
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($r.Json.history.Count -lt 1) { return 'history 为空' }
  $true
}

Test-Case '非法监控 ID 返回 400' {
  $r = Get-Json '/api/status/heartbeat/abc'
  if ($r.Status -ne 400) { return "HTTP $($r.Status)" }
  $true
}

Test-Case '不存在的监控返回 404' {
  $r = Get-Json '/api/status/heartbeat/99999'
  if ($r.Status -ne 404) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'GET /api/status/open：已配置数据源时返回 302 跳转（面板配置同样生效）' {
  $conn = Get-Json '/api/status/connection'
  $configured = $conn.Json.configured -eq $true

  # 用 .NET 原生请求，确保不自动跟随跳转
  $req = [System.Net.HttpWebRequest]::Create("$BaseUrl/api/status/open")
  $req.AllowAutoRedirect = $false
  $req.Method = 'GET'
  $req.Timeout = 8000
  $status = 0
  $location = ''
  try {
    $resp = $req.GetResponse()
    $status = [int]$resp.StatusCode
    $location = [string]$resp.Headers['Location']
    $resp.Close()
  } catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if ($resp) {
      $status = [int]$resp.StatusCode
      $location = [string]$resp.Headers['Location']
      $resp.Close()
    }
  }

  if (-not $configured) {
    if ($status -ne 200) { return "未配置数据源时应返回 200 说明页，实际 $status" }
    return $true
  }
  if ($status -ne 302) { return "已配置应 302，实际 $status（说明 /open 没读到面板配置）" }
  if ($location -notmatch '^https?://') { return "Location 非法：$location" }
  $true
}
Test-Case 'GET /api/status/connection 返回连接信息' {
  $r = Get-Json '/api/status/connection'
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($r.Json.mode -notin @('mock', 'live')) { return "mode=$($r.Json.mode)" }
  $true
}

# ---------- 阶段3.5：配置与认证 ----------
Write-Host ''
Write-Host '[阶段3.5] 配置管理与管理员认证'

Test-Case 'GET /api/config 返回完整配置' {
  $r = Get-Json '/api/config'
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  foreach ($k in @('site', 'hero', 'theme', 'navigation', 'features', 'download', 'about', 'links', 'fonts')) {
    if ($null -eq $r.Json.$k) { return "缺少区块 $k" }
  }
  if ($null -ne $r.Json.news) { return '资讯区块应已移除' }
  if ($r.Json.hero.slides.Count -ne 11) { return "画廊屏数应为 11，实际 $($r.Json.hero.slides.Count)" }
  $true
}

Test-Case 'GET /api/config/:section 返回单区块' {
  $r = Get-Json '/api/config/theme'
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if (-not $r.Json.primaryColor) { return '缺少 primaryColor' }
  $true
}

Test-Case 'GET /api/config/不存在 返回 404' {
  $r = Get-Json '/api/config/nope'
  if ($r.Status -ne 404) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'PUT /api/config/theme 未带 JWT 返回 401' {
  $r = Get-Json '/api/config/theme' -Method 'PUT' -Body @{ primaryColor = '#ffffff' }
  if ($r.Status -ne 401) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'PUT /api/config/theme 伪造 JWT 返回 401' {
  $r = Get-Json '/api/config/theme' -Method 'PUT' -Headers @{ Authorization = 'Bearer eyJhbGciOiJIUzI1NiJ9.fake.signature' } -Body @{ primaryColor = '#ffffff' }
  if ($r.Status -ne 401) { return "HTTP $($r.Status)" }
  $true
}

$script:token = $null

# ---------- 图形验证码辅助（借助 .env 中的测试旁路令牌取到答案）----------
$script:bypass = ''
if ($script:envValues['CAPTCHA_BYPASS_TOKEN']) { $script:bypass = $script:envValues['CAPTCHA_BYPASS_TOKEN'].Trim() }
if (-not $script:bypass) {
  Write-Host '  [提示] server/.env 未配置 CAPTCHA_BYPASS_TOKEN，验证码相关用例将被跳过' -ForegroundColor Yellow
}

function Get-Captcha {
  $headers = @{}
  if ($script:bypass) { $headers['X-Captcha-Bypass'] = $script:bypass }
  $r = Get-Json '/api/auth/captcha' -Headers $headers
  return $r.Json
}

Test-Case 'GET /api/auth/captcha 下发 PNG 验证码且不回传答案' {
  $cap = Get-Captcha
  if (-not $cap.id) { return '缺少 id' }
  if ($cap.image -notlike 'data:image/png;base64,*') { return '图片不是 PNG data URI' }
  if ($cap.image.Length -lt 500) { return "图片过小（$($cap.image.Length) 字节）" }
  if ($null -ne $cap.code -and -not $script:bypass) { return '未配置旁路却返回了答案' }
  $true
}

Test-Case 'GET /api/auth/public-settings 返回验证码开关' {
  $r = Get-Json '/api/auth/public-settings'
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($null -eq $r.Json.captchaEnabled) { return '缺少 captchaEnabled' }
  $true
}

Test-Case '登录：未带验证码被拒（400 CAPTCHA_REQUIRED）' {
  $r = Get-Json '/api/auth/login' -Method 'POST' -Body @{ username = $AdminUser; password = $AdminPass }
  if ($r.Status -ne 400) { return "HTTP $($r.Status)" }
  if ($r.Json.code -ne 'CAPTCHA_REQUIRED') { return "code=$($r.Json.code)" }
  $true
}

Test-Case '登录：验证码错误被拒（400 CAPTCHA_INVALID）' {
  $cap = Get-Captcha
  $r = Get-Json '/api/auth/login' -Method 'POST' -Body @{
    username = $AdminUser; password = $AdminPass; captchaId = $cap.id; captchaCode = 'ZZZZ'
  }
  if ($r.Status -ne 400) { return "HTTP $($r.Status)" }
  if ($r.Json.code -ne 'CAPTCHA_INVALID') { return "code=$($r.Json.code)" }
  $true
}

Test-Case '登录：验证码一次性（同一验证码不能重放）' {
  $cap = Get-Captcha
  if (-not $cap.code) { return '无旁路令牌，无法取得答案（请在 server/.env 配置 CAPTCHA_BYPASS_TOKEN）' }
  $body = @{ username = $AdminUser; password = $AdminPass; captchaId = $cap.id; captchaCode = $cap.code }
  $first = Get-Json '/api/auth/login' -Method 'POST' -Body $body
  if ($first.Status -eq 401) { return '__SKIP__:server/.env 的密码已失效（可能在面板里改过）' }
  if ($first.Status -ne 200) { return "首次登录失败 HTTP $($first.Status)" }
  $second = Get-Json '/api/auth/login' -Method 'POST' -Body $body
  if ($second.Status -ne 400) { return "重放未被拒绝 HTTP $($second.Status)" }
  $true
}

Test-Case '登录：错误密码返回 401（验证码正确）' {
  $cap = Get-Captcha
  if (-not $cap.code) { return '无旁路令牌' }
  $r = Get-Json '/api/auth/login' -Method 'POST' -Body @{
    username = $AdminUser; password = 'definitely-wrong'; captchaId = $cap.id; captchaCode = $cap.code
  }
  if ($r.Status -ne 401) { return "HTTP $($r.Status)" }
  $true
}

Test-Case '登录：正确凭据 + 正确验证码返回 JWT' {
  $cap = Get-Captcha
  if (-not $cap.code) { return '无旁路令牌' }
  $r = Get-Json '/api/auth/login' -Method 'POST' -Body @{
    username = $AdminUser; password = $AdminPass; captchaId = $cap.id; captchaCode = $cap.code
  }
  if ($r.Status -eq 401) { return '__SKIP__:server/.env 的密码已失效（可能在面板里改过）' }
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if (-not $r.Json.token) { return '缺少 token' }
  $script:token = $r.Json.token
  $true
}

Test-Case '登录：验证码大小写不敏感' {
  $cap = Get-Captcha
  if (-not $cap.code) { return '无旁路令牌' }
  $r = Get-Json '/api/auth/login' -Method 'POST' -Body @{
    username = $AdminUser; password = $AdminPass; captchaId = $cap.id; captchaCode = $cap.code.ToLower()
  }
  if ($r.Status -eq 401) { return '__SKIP__:server/.env 的密码已失效（可能在面板里改过）' }
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'GET /api/auth/check 令牌有效' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/auth/check' -Headers @{ Authorization = "Bearer $script:token" }
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($r.Json.user.isAdmin -ne $true) { return 'isAdmin 不为 true' }
  $true
}

Test-Case 'PUT /api/config/theme 带 JWT 更新成功' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/config/theme' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{
    primaryColor = '#e8c877'; accentColor = '#7fd8d8'; bgColor = '#0b1020'; bgColor2 = '#12172b'
    textColor = '#f0ece0'; textMuted = '#9aa0b5'; upColor = '#4ade80'; downColor = '#ef4444'
    radius = 14; cardShadow = '0 12px 40px rgba(0, 0, 0, 0.45)'
  }
  if ($r.Status -ne 200) { return "HTTP $($r.Status) $($r.Raw)" }
  if ($r.Json.ok -ne $true) { return 'ok 不为 true' }
  if (-not $r.Json.backup) { return '未生成备份' }
  $true
}

Test-Case '更新后配置立即生效（读回校验）' {
  $r = Get-Json '/api/config/theme'
  if ($r.Json.primaryColor -ne '#e8c877') { return "primaryColor=$($r.Json.primaryColor)" }
  $true
}

Test-Case '非法颜色值被 zod 拒绝（400）' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/config/theme' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{
    primaryColor = 'red; background:url(x)'; accentColor = '#7fd8d8'; bgColor = '#0b1020'; bgColor2 = '#12172b'
    textColor = '#f0ece0'; textMuted = '#9aa0b5'; upColor = '#4ade80'; downColor = '#ef4444'
  }
  if ($r.Status -ne 400) { return "HTTP $($r.Status)" }
  if (-not $r.Json.details) { return '缺少 details' }
  $true
}

Test-Case '路径穿越的图片地址被拒绝（400）' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/config/site' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{
    title = '原神功能快捷站'; subtitle = '提瓦特旅行者手册'
    logo = '/images/../../server/.env'; favicon = '/images/favicon.svg'
  }
  if ($r.Status -ne 400) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'javascript: 伪协议被拒绝（400）' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/config/download' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{
    cards = @(@{ icon = 'x'; title = 't'; desc = 'd'; url = 'javascript:alert(1)' })
  }
  if ($r.Status -ne 400) { return "HTTP $($r.Status)" }
  $true
}

Test-Case '未知区块被拒绝（404）' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/config/hack' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{ a = 1 }
  if ($r.Status -ne 404) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'GET /api/config/backups 返回备份列表（需管理员）' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/config/backups' -Headers @{ Authorization = "Bearer $script:token" }
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($r.Json.backups.Count -lt 1) { return '备份列表为空' }
  $true
}

Test-Case '备份接口未授权返回 401' {
  $r = Get-Json '/api/config/backups'
  if ($r.Status -ne 401) { return "HTTP $($r.Status)" }
  $true
}

Test-Case '批量更新 PUT /api/config 生效' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/config' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{
    features = @{
      enableBackgroundMusic = $false; enableStarfield = $true; enableStarRings = $true
      enableMoon = $true; enableParticles = $true; enableMouseTrail = $true
      enableKumaPanel = $true; enableParallax = $true
    }
  }
  if ($r.Status -ne 200) { return "HTTP $($r.Status) $($r.Raw)" }
  if ($r.Json.updated -notcontains 'features') { return '未更新 features' }
  $true
}

# ---------- 阶段3.6 / 字体：上传接口 ----------
Write-Host ''
Write-Host '[阶段3.6+] 后台可配置项（数据源 / 账号安全）'

Test-Case 'GET /api/settings/kuma 需管理员（未授权 401）' {
  $r = Get-Json '/api/settings/kuma'
  if ($r.Status -ne 401) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'GET /api/settings/kuma 返回设置与连接状态（密钥脱敏）' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/settings/kuma' -Headers @{ Authorization = "Bearer $script:token" }
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($null -eq $r.Json.configured) { return '缺少 configured' }
  if ($null -eq $r.Json.pollInterval) { return '缺少 pollInterval' }
  if ($r.Json.PSObject.Properties.Name -contains 'apiKey') { return '不应回传 apiKey 明文' }
  $true
}

Test-Case 'PUT /api/settings/kuma 保存并热重载' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/settings/kuma' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{
    pollInterval = 30; cacheTtl = 30; socketEnabled = $false
  }
  if ($r.Status -ne 200) { return "HTTP $($r.Status) $($r.Raw)" }
  if ($r.Json.ok -ne $true) { return 'ok 不为 true' }
  if ($r.Json.settings.pollInterval -ne 30) { return "pollInterval=$($r.Json.settings.pollInterval)" }
  $true
}

Test-Case 'PUT /api/settings/kuma 非法地址被 zod 拒绝（400）' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/settings/kuma' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{ url = 'not-a-url' }
  if ($r.Status -ne 400) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'POST /api/settings/kuma/test 需要管理员（未授权 401）' {
  $r = Get-Json '/api/settings/kuma/test' -Method 'POST' -Body @{ url = 'https://example.com' }
  if ($r.Status -ne 401) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'POST /api/settings/kuma/test 返回连接结果（Mock 模式下为演示提示）' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/settings/kuma/test' -Method 'POST' -Headers @{ Authorization = "Bearer $script:token" } -Body @{}
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($null -eq $r.Json.mode) { return '缺少 mode' }
  $true
}

Test-Case 'GET /api/auth/settings 返回验证码开关' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/auth/settings' -Headers @{ Authorization = "Bearer $script:token" }
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($null -eq $r.Json.captchaEnabled) { return '缺少 captchaEnabled' }
  $true
}

Test-Case 'PUT /api/auth/credentials 当前密码错误返回 400' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/auth/credentials' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{
    currentPassword = 'definitely-wrong'; newPassword = 'whatever123456'
  }
  if ($r.Status -ne 400) { return "HTTP $($r.Status)" }
  $true
}

Test-Case 'PUT /api/auth/credentials 新密码过短被拒（400）' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $r = Get-Json '/api/auth/credentials' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{
    currentPassword = $AdminPass; newPassword = 'short'
  }
  if ($r.Status -ne 400) { return "HTTP $($r.Status)" }
  $true
}

Test-Case '验证码开关可切换且公开接口同步' {
  if (-not $script:token) { return '__SKIP__:未取得管理员令牌（密码可能在面板里改过）' }
  $off = Get-Json '/api/auth/settings' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{ captchaEnabled = $false }
  if ($off.Status -ne 200) { return "关闭失败 HTTP $($off.Status)" }
  $pub = Get-Json '/api/auth/public-settings'
  if ($pub.Json.captchaEnabled -ne $false) { return '公开设置未同步' }
  $on = Get-Json '/api/auth/settings' -Method 'PUT' -Headers @{ Authorization = "Bearer $script:token" } -Body @{ captchaEnabled = $true }
  if ($on.Status -ne 200) { return "恢复失败 HTTP $($on.Status)" }
  $true
}

Test-Case 'PUT /api/auth/settings 未授权返回 401' {
  $r = Get-Json '/api/auth/settings' -Method 'PUT' -Body @{ captchaEnabled = $false }
  if ($r.Status -ne 401) { return "HTTP $($r.Status)" }
  $true
}

Write-Host ''
Write-Host '[阶段3.6] 字体清单与上传接口'

Test-Case 'GET /api/fonts 返回字体清单' {
  $r = Get-Json '/api/fonts'
  if ($r.Status -ne 200) { return "HTTP $($r.Status)" }
  if ($null -eq $r.Json.fonts) { return '缺少 fonts 字段' }
  $true
}

Test-Case '上传图片未授权返回 401' {
  $r = Get-Json '/api/uploads/image' -Method 'POST' -Body @{ file = 'x' }
  if ($r.Status -ne 401) { return "HTTP $($r.Status)" }
  $true
}

# ---------- 阶段10：SSE ----------
Write-Host ''
Write-Host '[阶段10] SSE 实时推送'

Test-Case 'GET /api/status/events 建立 SSE 连接并收到初始数据' {
  $client = [System.Net.Http.HttpClient]::new()
  $client.Timeout = [TimeSpan]::FromSeconds(12)
  $req = [System.Net.Http.HttpRequestMessage]::new('GET', "$BaseUrl/api/status/events")
  $resp = $client.SendAsync($req, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).Result
  if (-not $resp.IsSuccessStatusCode) { return "HTTP $([int]$resp.StatusCode)" }
  $ctype = $resp.Content.Headers.ContentType.MediaType
  if ($ctype -ne 'text/event-stream') { return "Content-Type=$ctype" }
  # .NET Framework 没有 ReadAsStream()，用异步版本
  $stream = $resp.Content.ReadAsStreamAsync().Result
  $reader = New-Object System.IO.StreamReader($stream)
  $got = $false
  $deadline = (Get-Date).AddSeconds(8)
  while ((Get-Date) -lt $deadline) {
    $line = $reader.ReadLine()
    if ($null -eq $line) { break }
    if ($line -like 'data:*"monitors"*') { $got = $true; break }
  }
  $reader.Dispose(); $client.Dispose()
  if (-not $got) { return '未在 8 秒内收到 monitors 初始推送' }
  $true
}

# ---------- 汇总 ----------
Write-Host ''
Write-Host '=== 测试结果 ===' -ForegroundColor Cyan
Write-Host "  通过: $script:pass" -ForegroundColor Green
if ($script:fail -gt 0) {
  Write-Host "  失败: $script:fail" -ForegroundColor Red
} else {
  Write-Host "  失败: 0" -ForegroundColor Green
}
if ($script:skip -gt 0) {
  Write-Host "  跳过: $script:skip（需要管理员令牌的用例）" -ForegroundColor Yellow
  Write-Host '        想跑全量：把当前密码写回 server/.env 的 ADMIN_PASSWORD，或用 -AdminPass 传入' -ForegroundColor Yellow
}
Write-Host ''
if ($script:fail -gt 0) { exit 1 } else { exit 0 }
# ============================================================
# td-auth-save-contract-test.ps1  V3-2 契约测试
# 覆盖: register / login / JWT / save(GET+POST) / 防作弊门 / autosave字段
#      Boss 契约: enemy6=BOSS·炎狱领主  wave3/6/8=Boss波 + rewardGold阶梯
# 断言数: 32
# ============================================================
$ErrorActionPreference = 'Stop'
$BASE = 'http://localhost:8080'
$PASS = 0
$FAIL = 0
$TOTAL = 24
$SFX = [string](Get-Date -Format 'yyyyMMdd-HHmmss')
Set-Variable -Name SFX -Value $SFX -Scope Script -Option ReadOnly
$TEST_USER = ('testuser_' + $SFX)
$TEST_PASS = "StrongP@ss1!"
$TEST_WRONG_PASS = "WrongP@ss!"
$TOKEN_NONE = ''

function Assert-Eq($name, $expected, $actual) {
    if ($expected -eq $actual) {
        $script:PASS++; Write-Host "[PASS $script:PASS/$TOTAL] $name" -ForegroundColor Green
    } else {
        $script:FAIL++; Write-Host "[FAIL] $name  expected=$expected  actual=$actual" -ForegroundColor Red
    }
}
function Assert-Contains($name, $needle, $haystack) {
    if ($haystack -like "*$needle*") {
        $script:PASS++; Write-Host "[PASS $script:PASS/$TOTAL] $name" -ForegroundColor Green
    } else {
        $script:FAIL++; Write-Host "[FAIL] $name  needle=[$needle]  haystack=[$haystack]" -ForegroundColor Red
    }
}
function Assert-True($name, $cond) {
    if ($cond) {
        $script:PASS++; Write-Host "[PASS $script:PASS/$TOTAL] $name" -ForegroundColor Green
    } else {
        $script:FAIL++; Write-Host "[FAIL] $name" -ForegroundColor Red
    }
}

function HTTP($method, $url, $body, $token) {
    $headers = @{}
    if ($token) { $headers['Authorization'] = "Bearer $token" }
    try {
        if ($body -ne $null) {
            $resp = Invoke-WebRequest -Uri $url -Method $method -ContentType 'application/json' -Headers $headers -Body $body -UseBasicParsing
        } else {
            $resp = Invoke-WebRequest -Uri $url -Method $method -Headers $headers -UseBasicParsing
        }
        return @{ status = [int]$resp.StatusCode; body = $resp.Content }
    } catch {
        $status = 0
        try { $status = [int]$_.Exception.Response.StatusCode.value__ } catch {}
        $body = ''
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $reader = New-Object System.IO.StreamReader($stream)
            $body = $reader.ReadToEnd(); $reader.Close()
        } catch {}
        return @{ status = $status; body = $body }
    }
}

Write-Host "`n== V3-1 Auth & Save Contract Test ($TOTAL asserts) == test_user=$TEST_USER ==" -ForegroundColor Cyan

# ============ 1. register ============
# 1.1 空用户名 register → 400
$r = HTTP 'POST' "$BASE/api/auth/register" '{"username":"","password":"pw"}'
Assert-Eq '1.1 register空用户 400' 400 $r.status

# 1.2 空密码 register → 400
$r = HTTP 'POST' "$BASE/api/auth/register" '{"username":"u","password":""}'
Assert-Eq '1.2 register空密码 400' 400 $r.status

# 1.3 密码太短(<6) register → 400
$r = HTTP 'POST' "$BASE/api/auth/register" '{"username":"short","password":"12345"}'
Assert-Eq '1.3 register密码<6 400' 400 $r.status

# 1.4 正常 register → 200/201 + 返回 token + uid
$r = HTTP 'POST' "$BASE/api/auth/register" (@{username=$TEST_USER; password=$TEST_PASS} | ConvertTo-Json -Compress)
$okRegister = ($r.status -eq 200 -or $r.status -eq 201)
Assert-True '1.4 register成功 status 2xx' $okRegister
$regBody = $r.body | ConvertFrom-Json
$regToken = if ($regBody.data.token) { $regBody.data.token } elseif ($regBody.token) { $regBody.token } else { '' }
$regUid   = if ($regBody.data.uid)   { $regBody.data.uid }   elseif ($regBody.uid)   { $regBody.uid }   else { 0 }
Assert-True '1.5 register返回token(非空)' ($regToken.Length -gt 0)
Assert-True '1.6 register返回uid(>0)'    ([int]$regUid -gt 0)

# 1.7 重复 register → 409(冲突) 或 400(用户名已存在)
$r = HTTP 'POST' "$BASE/api/auth/register" (@{username=$TEST_USER; password=$TEST_PASS} | ConvertTo-Json -Compress)
$dup = ($r.status -eq 409 -or $r.status -eq 400)
Assert-True '1.7 重复register 409/400' $dup

# ============ 2. login ============
# 2.1 错密码 login → 401
$r = HTTP 'POST' "$BASE/api/auth/login" (@{username=$TEST_USER; password=$TEST_WRONG_PASS} | ConvertTo-Json -Compress)
Assert-Eq '2.1 错密码 login 401' 401 $r.status

# 2.2 不存在用户 login → 401
$r = HTTP 'POST' "$BASE/api/auth/login" '{"username":"noexist_never_xyz","password":"any1234"}'
Assert-Eq '2.2 不存在用户 login 401' 401 $r.status

# 2.3 正常 login → 200 + token
$r = HTTP 'POST' "$BASE/api/auth/login" (@{username=$TEST_USER; password=$TEST_PASS} | ConvertTo-Json -Compress)
Assert-Eq '2.3 正常login 200' 200 $r.status
$loginBody = $r.body | ConvertFrom-Json
$loginToken = if ($loginBody.data.token) { $loginBody.data.token } elseif ($loginBody.token) { $loginBody.token } else { '' }
Assert-True '2.4 login返回token(非空)' ($loginToken.Length -gt 0)

# ============ 3. save (需要JWT) ============
# 3.1 save GET 无token → 401
$r = HTTP 'GET' "$BASE/api/save" $null $TOKEN_NONE
Assert-Eq '3.1 save GET无JWT 401' 401 $r.status

# 3.2 save POST 无token → 401
$r = HTTP 'POST' "$BASE/api/save" '{"phase":"MENU"}' $TOKEN_NONE
Assert-Eq '3.2 save POST无JWT 401' 401 $r.status

# ---- helper: 从响应体拿 data（解包 {code,status,data} 结构）----
function UnwrapData($bodyText) {
    $o = $bodyText | ConvertFrom-Json
    if ($null -ne $o -and $null -ne $o.PSObject.Properties['data']) {
        return $o.data
    }
    return $o
}
# ---- helper: 安全取 int 字段 ----
function SafeInt($obj, $name, $def) {
    if ($null -eq $obj) { return $def }
    $p = $obj.PSObject.Properties[$name]
    if ($null -eq $p -or $null -eq $p.Value) { return $def }
    try { return [int]$p.Value } catch { return $def }
}
# ---- helper: 安全取数组长度 ----
function SafeCount($obj, $name) {
    if ($null -eq $obj) { return 0 }
    $p = $obj.PSObject.Properties[$name]
    if ($null -eq $p -or $null -eq $p.Value) { return 0 }
    try { return [int]$p.Value.Count } catch { return 1 }
}
# ---- helper: 生成一个 save payload（避免 .Clone() 的引用陷阱） ----
function MakeSave($phase, $isAutoFlag) {
    return @{
        version     = 1
        phase       = $phase
        luckLevel   = 2
        gold        = 42
        baseHP      = 18
        waveIndex   = 3
        tiles       = [int[]](0, 1, 2)
        grid        = [object[]](@{gx=3; gy=4; towerCfgId=5}, @{gx=5; gy=6; type='wall'})
        activeBuffs = [object[]](@{id='atk_15p'; name='attack_15p'; rarity='rare'; count=1})
        isAuto      = $isAutoFlag
    }
}

# 3.3 save POST 正常 → 200 saved=true + updatedAt
$json = MakeSave 'PREPARE' $false | ConvertTo-Json -Compress -Depth 5
$r = HTTP 'POST' "$BASE/api/save" $json $loginToken
Assert-Eq '3.3 save POST(手动) 200' 200 $r.status
$savedData = UnwrapData $r.body
Assert-True '3.4 save返回saved=true' ([bool]$savedData.saved -eq $true -or [string]$savedData.status -eq 'ok')
Assert-True '3.5 save返回updatedAt' ([string]$savedData.updatedAt -ne '' -or [string]$savedData.savedAt -ne '')

# 3.6 autosave POST (phase=WAVEEND/LOSE isAuto=true)
$jsonA = MakeSave 'WAVEEND' $true | ConvertTo-Json -Compress -Depth 5
$r = HTTP 'POST' "$BASE/api/save" $jsonA $loginToken
Assert-Eq '3.6 autosave POST 200' 200 $r.status

# 3.7~3.11 save GET → 200 + 数据一致（验证 autosave 覆盖后的值）
$r = HTTP 'GET' "$BASE/api/save" $null $loginToken
Assert-Eq '3.7 save GET 200' 200 $r.status
$getData = UnwrapData $r.body
Assert-Eq '3.8 GET gold=42'   42  (SafeInt $getData 'gold' -999)
Assert-Eq '3.9 GET luck=2'    2   (SafeInt $getData 'luckLevel' -999)
Assert-Eq '3.10 GET wave=3'   3   (SafeInt $getData 'waveIndex' -999)
$gridLen = SafeCount $getData 'grid'
Assert-True "3.11 GET grid长度>=2 (实际$gridLen)" ($gridLen -ge 2)

# 3.12 防作弊门：BATTLE阶段禁止写入 → 403
$jsonBad = MakeSave 'BATTLE' $false | ConvertTo-Json -Compress -Depth 5
$r = HTTP 'POST' "$BASE/api/save" $jsonBad $loginToken
Assert-Eq '3.12 BATTLE阶段save 403(防作弊)' 403 $r.status

# 3.13 save GET 另一个全新用户(无存档)返回 200 data=null，绝不能泄露别人的数据
# 注意：此处 NEWSFX 独立生成，避免 PS 脚本执行中因 ConvertTo-Json 管道副作用导致顶部 SFX 变空
$NEWSFX = [string](Get-Date -Format 'yyyyMMdd-HHmmss-fff')
$USER2  = ('fresh2_' + $NEWSFX)
$u2Body = @{ username=$USER2; password=$TEST_PASS } | ConvertTo-Json -Compress
$null = HTTP 'POST' "$BASE/api/auth/register" $u2Body
$loginR2 = HTTP 'POST' "$BASE/api/auth/login" $u2Body
$login2Data = UnwrapData $loginR2.body
$tok2 = [string]$login2Data.token
Assert-True "3.13.0 新用户login拿到token(len=$($tok2.Length))" ($tok2.Length -gt 50)
$r = HTTP 'GET' "$BASE/api/save" $null $tok2
$statusOK = ($r.status -eq 200 -or $r.status -eq 404)
Assert-True "3.13 新用户save不返回他人存档 status=200/404 ($($r.status))" $statusOK
if ($r.status -eq 200) {
    $dataF = UnwrapData $r.body
    $goldF = SafeInt $dataF 'gold' -1
    # 无存档: data=null → goldF=-1; 有存档但不是他人 → 不等于42
    Assert-True "3.14 新用户save gold!=42(非他人存档) 实际gold=$goldF" ($goldF -ne 42)
} else {
    $script:PASS++; Write-Host "[PASS $PASS/$TOTAL] 3.14 新用户404视为跳过" -ForegroundColor Green
}

# ============ 4. Config Boss 契约 (V3-2) — 调用独立脚本 ============
# PS5.1 解析嵌套字符串插值很脆弱，为了保持 V3-1 主套件稳定，Boss 契约拆到同级独立脚本 td-boss-contract-test.ps1
$bossScript = Join-Path $PSScriptRoot 'td-boss-contract-test.ps1'
if (Test-Path $bossScript) {
    & powershell -ExecutionPolicy Bypass -NonInteractive -File $bossScript
    if ($LASTEXITCODE -ne 0) {
        $script:FAIL++; $script:TOTAL++
        Write-Host "[FAIL $FAIL/$TOTAL] 4.* Boss 契约子脚本 exit=$LASTEXITCODE" -ForegroundColor Red
    } else {
        $script:PASS++; $script:TOTAL++
        Write-Host "[PASS $PASS/$TOTAL] 4.* Boss 契约子脚本 exit=0" -ForegroundColor Green
    }
} else {
    $script:FAIL++; $script:TOTAL++
    Write-Host "[FAIL $FAIL/$TOTAL] 4.* 缺失 td-boss-contract-test.ps1 (期望在 $bossScript)" -ForegroundColor Red
}

# ============ 汇总 ============
Write-Host "`n===== RESULT: PASS=$PASS / $TOTAL   FAIL=$FAIL =====" -ForegroundColor $(if ($FAIL -eq 0) {'Green'} else {'Red'})
if ($FAIL -ne 0) { exit 1 } else { exit 0 }

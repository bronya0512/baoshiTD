# ============================================================
# td-boss-contract-test.ps1  V3-2 Boss 契约子脚本
# 依赖: 后端已在 localhost:8080 启动
# 断言数: 20
# ============================================================
$ErrorActionPreference = 'Stop'
$BASE = 'http://localhost:8080'
$PASS = 0
$FAIL = 0
$TOTAL = 0

function HTTP($method, $url, $body) {
    $headers = @{}
    try {
        if ($body) {
            $resp = Invoke-WebRequest -Uri $url -Method $method -Body $body `
                -ContentType 'application/json' -Headers $headers -UseBasicParsing -TimeoutSec 15
        } else {
            $resp = Invoke-WebRequest -Uri $url -Method $method -Headers $headers -UseBasicParsing -TimeoutSec 15
        }
        return [pscustomobject]@{ status = [int]$resp.StatusCode; body = $resp.Content }
    } catch {
        $code = 0
        if ($_.Exception.Response) {
            try { $code = [int]$_.Exception.Response.StatusCode } catch {}
        }
        $txt = ''
        if ($_.Exception.Response) {
            try {
                $rs = $_.Exception.Response.GetResponseStream()
                $rd = New-Object System.IO.StreamReader($rs)
                $txt = $rd.ReadToEnd()
            } catch {}
        }
        if (-not $txt) { $txt = $_.Exception.Message }
        return [pscustomobject]@{ status = $code; body = $txt }
    }
}

function Assert-Eq($name, $expect, $actual) {
    $script:TOTAL++
    if ($actual -eq $expect) {
        $script:PASS++
        Write-Host ('[PASS ' + $PASS + '/' + $TOTAL + '] ' + $name + '  expect=' + $expect + ' actual=' + $actual) -ForegroundColor Green
    } else {
        $script:FAIL++
        Write-Host ('[FAIL ' + $FAIL + '/' + $TOTAL + '] ' + $name + '  expect=' + $expect + ' actual=' + $actual) -ForegroundColor Red
    }
}

function Assert-True($name, $cond) {
    $script:TOTAL++
    if ($cond) {
        $script:PASS++
        Write-Host ('[PASS ' + $PASS + '/' + $TOTAL + '] ' + $name) -ForegroundColor Green
    } else {
        $script:FAIL++
        Write-Host ('[FAIL ' + $FAIL + '/' + $TOTAL + '] ' + $name) -ForegroundColor Red
    }
}

function SafeInt($obj, $key, $def) {
    if ($null -eq $obj) { return $def }
    $val = $null
    if ($obj.PSObject.Properties[$key] -ne $null) { $val = $obj.PSObject.Properties[$key].Value }
    else {
        $lo = $key.ToLower()
        foreach ($p in $obj.PSObject.Properties) {
            if ($p.Name.ToLower() -eq $lo) { $val = $p.Value; break }
        }
    }
    try { return [int]$val } catch { return $def }
}

function SafeDouble($obj, $key, $def) {
    if ($null -eq $obj) { return $def }
    $val = $null
    if ($obj.PSObject.Properties[$key] -ne $null) { $val = $obj.PSObject.Properties[$key].Value }
    else {
        $lo = $key.ToLower()
        foreach ($p in $obj.PSObject.Properties) {
            if ($p.Name.ToLower() -eq $lo) { $val = $p.Value; break }
        }
    }
    try { return [double]$val } catch { return $def }
}

function SafeStr($obj, $key, $def) {
    if ($null -eq $obj) { return $def }
    if ($obj.PSObject.Properties[$key] -ne $null) { return [string]$obj.PSObject.Properties[$key].Value }
    $lo = $key.ToLower()
    foreach ($p in $obj.PSObject.Properties) {
        if ($p.Name.ToLower() -eq $lo) { return [string]$p.Value }
    }
    return $def
}

function SafeProp($obj, $key, $def) {
    if ($null -eq $obj) { return $def }
    if ($obj.PSObject.Properties[$key] -ne $null) { return $obj.PSObject.Properties[$key].Value }
    $lo = $key.ToLower()
    foreach ($p in $obj.PSObject.Properties) {
        if ($p.Name.ToLower() -eq $lo) { return $p.Value }
    }
    return $def
}

function FindEnemyById($arr, $id) {
    foreach ($e in $arr) {
        $thisId = SafeInt $e 'id' -1
        if ($thisId -eq $id) { return $e }
    }
    return $null
}

function FindWaveByNum($arr, $num) {
    foreach ($w in $arr) {
        $thisNum = SafeInt $w 'wave' -1
        if ($thisNum -eq -1) { $thisNum = SafeInt $w 'id' -1 }
        if ($thisNum -eq $num) { return $w }
    }
    return $null
}

function WaveHasEnemy($wave, $enemyId) {
    $groups = SafeProp $wave 'groups' $null
    if (-not ($groups -is [array])) { return $false }
    foreach ($g in $groups) {
        $eid = SafeInt $g 'enemyId' -1
        if ($eid -eq -1) { $eid = SafeInt $g 'EnemyID' -1 }
        if ($eid -eq $enemyId) {
            $cnt = SafeInt $g 'count' 0
            if ($cnt -eq 0) { $cnt = SafeInt $g 'Count' 0 }
            if ($cnt -ge 1) { return $true }
        }
    }
    return $false
}

# ---------- load ----------
$eResp = HTTP 'GET' ($BASE + '/api/config/enemies') $null
$wResp = HTTP 'GET' ($BASE + '/api/config/waves/1') $null

Assert-Eq 'B1 enemies endpoint 200' 200 $eResp.status
Assert-Eq 'B2 waves/1   endpoint 200' 200 $wResp.status

$enemiesArr = @()
$wavesArr   = @()
try {
    $eJ = $eResp.body | ConvertFrom-Json
    if ($eJ -and $eJ.data -is [array]) { $enemiesArr = @($eJ.data) }
    elseif ($eJ -and $eJ.data -and $eJ.data.enemies -is [array]) { $enemiesArr = @($eJ.data.enemies) }
} catch { Write-Host ('parse enemies JSON failed: ' + $_.Exception.Message) -ForegroundColor Yellow }
try {
    $wJ = $wResp.body | ConvertFrom-Json
    if ($wJ -and $wJ.data -is [array]) { $wavesArr = @($wJ.data) }
    elseif ($wJ -and $wJ.data -and $wJ.data.waveConfigs -is [array]) { $wavesArr = @($wJ.data.waveConfigs) }
    elseif ($wJ -and $wJ.data -and $wJ.data.waves -is [array]) { $wavesArr = @($wJ.data.waves) }
} catch { Write-Host ('parse waves JSON failed: ' + $_.Exception.Message) -ForegroundColor Yellow }

$enCnt = $enemiesArr.Count
$wvCnt = $wavesArr.Count
Assert-True  ('B3 enemies>=6 (got ' + $enCnt + ')')  ($enCnt -ge 6)
Assert-True  ('B4 waves>=8   (got ' + $wvCnt + ')')  ($wvCnt -ge 8)

$e6 = FindEnemyById $enemiesArr 6
Assert-True 'B5 enemy id=6 存在' ($null -ne $e6)
if ($e6) {
    $name = SafeStr $e6 'name' ''
    $hp   = SafeInt $e6 'baseHP'   -999
    $sp   = SafeInt $e6 'speed'    -999
    $rpx  = SafeInt $e6 'radiusPx' -999
    $dtb  = SafeInt $e6 'damageToBase' -999
    $boss = [bool](SafeProp $e6 'isBoss' $false)
    $drop = SafeDouble $e6 'dropBonusRate' -1.0
    Assert-Eq   'B6 enemy6 name'  'BOSS·炎狱领主'  $name
    Assert-Eq   'B7 enemy6 BaseHP'  1200  $hp
    Assert-Eq   'B8 enemy6 Speed'      32  $sp
    Assert-Eq   'B9 enemy6 radiusPx'   28  $rpx
    Assert-Eq   'B10 enemy6 damageToBase' 5  $dtb
    Assert-True 'B11 enemy6 isBoss=true'     $boss
    Assert-True ('B12 enemy6 dropBonusRate=1.0 (got ' + $drop + ')')  ([Math]::Abs($drop - 1.0) -lt 0.001)
} else {
    foreach ($n in 6..12) {
        $script:FAIL++; $script:TOTAL++
        Write-Host ('[FAIL ' + $FAIL + '/' + $TOTAL + '] B' + $n + ' enemy6 missing -> skip') -ForegroundColor Red
    }
}

$w3 = FindWaveByNum $wavesArr 3
$w6 = FindWaveByNum $wavesArr 6
$w8 = FindWaveByNum $wavesArr 8
Assert-True 'B13 wave3 存在' ($null -ne $w3)
if ($w3) {
    Assert-True  'B14 wave3 isBossWave=true'  ([bool](SafeProp $w3 'isBossWave' $false))
    $rg = SafeInt $w3 'rewardGold' -99
    if ($rg -eq -99) { $rg = SafeInt $w3 'rewardCoin' -99 }
    Assert-Eq    'B15 wave3 rewardGold=100'  100  $rg
    Assert-True  'B16 wave3 含 EnemyID=6'    (WaveHasEnemy $w3 6)
} else {
    foreach ($n in 14..16) {
        $script:FAIL++; $script:TOTAL++
        Write-Host ('[FAIL ' + $FAIL + '/' + $TOTAL + '] B' + $n + ' wave3 missing -> skip') -ForegroundColor Red
    }
}
Assert-True 'B17 wave6 存在' ($null -ne $w6)
if ($w6) {
    Assert-True  'B18 wave6 isBossWave=true'  ([bool](SafeProp $w6 'isBossWave' $false))
    $rg = SafeInt $w6 'rewardGold' -99
    if ($rg -eq -99) { $rg = SafeInt $w6 'rewardCoin' -99 }
    Assert-Eq    'B19 wave6 rewardGold=150'  150  $rg
    Assert-True  'B20 wave6 含 EnemyID=6'    (WaveHasEnemy $w6 6)
} else {
    foreach ($n in 18..20) {
        $script:FAIL++; $script:TOTAL++
        Write-Host ('[FAIL ' + $FAIL + '/' + $TOTAL + '] B' + $n + ' wave6 missing -> skip') -ForegroundColor Red
    }
}

# ============ 汇总 ============
Write-Host ''
Write-Host ('===== BOSS CONTRACT RESULT: PASS=' + $PASS + ' / ' + $TOTAL + '   FAIL=' + $FAIL + ' =====') `
    -ForegroundColor $(if ($FAIL -eq 0) {'Green'} else {'Red'})
if ($FAIL -ne 0) { exit 1 } else { exit 0 }

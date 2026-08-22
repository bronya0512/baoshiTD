# Tower Defense MVP 后端 Contract Smoke Tests
# 用法：在 PowerShell 里：cd baoshiTD ;  powershell -ExecutionPolicy Bypass -File .\scripts\td-api-contract-test.ps1
# 预期：全 PASS；若有 FAIL 说明后端代码未实现/字段不符合 openapi.yaml

$Base = 'http://localhost:8080'
$FailCount = 0

function Check($name, $cond, $detail='') {
    if ($cond) {
        Write-Host "[PASS] $name" -ForegroundColor Green
        if ($detail) { Write-Host "       > $detail" }
    } else {
        Write-Host "[FAIL] $name" -ForegroundColor Red
        if ($detail) { Write-Host "       > $detail" }
        $script:FailCount++
    }
}

$paths = @()
$paths += @{ p = '/api/config/towers';  kind = 'array';  must = 'TowerConfig[0].levels[0].baseDamage is number and cost>=0'
  checkProp = { param($o); $o.Count -ge 2 -and ($o[0].levels[0].baseDamage -is [double] -or $o[0].levels[0].baseDamage -is [int]) -and ([int]$o[0].levels[0].cost -ge 0) } }
$paths += @{ p = '/api/config/enemies'; kind = 'array';  must = 'EnemyConfig[0].baseHP>0 and name exists'
  checkProp = { param($o); $o.Count -ge 3 -and ([double]$o[0].baseHP -gt 0) -and ([string]$o[0].name -ne '') } }
$paths += @{ p = '/api/config/gems';    kind = 'object'; must = 'GemConfig elements>=5 and rarities>=4'
  checkProp = { param($o); $o.elements.Count -ge 5 -and $o.rarities.Count -ge 4 } }
$paths += @{ p = '/api/config/maps';    kind = 'array';  must = 'MapInfo[] has id=1'
  checkProp = { param($o); $o.Count -ge 1 -and (@($o | Where-Object { $_.id -eq 1 }).Count -eq 1) } }
$paths += @{ p = '/api/config/waves/1'; kind = 'array';  must = 'WaveConfig[] has at least 6 waves'
  checkProp = { param($o); $o.Count -ge 6 -and $o[-1].groups.Count -ge 1 } }
$paths += @{ p = '/api/config/maps/1';  kind = 'object'; must = 'MapDetail gridWidth=24 and base.hp=20'
  checkProp = { param($o); [int]$o.gridWidth -eq 24 -and [int]$o.base.hp -eq 20 } }
$paths += @{ p = '/api/config/waves/999'; kind = '404'; must = 'HTTP 4xx without panic'; noThrow = $true }

foreach ($t in $paths) {
    try {
        $r = Invoke-WebRequest -Uri "$Base$($t.p)" -UseBasicParsing -TimeoutSec 5
        $ct = $r.Headers['Content-Type'] -join ';'
        if ($t.kind -eq '404') {
            Check "正常路径返回非 4xx / 错误路径非崩溃 [$($t.p)]" $false "HTTP 200 对错误路径应该是 4xx"
            continue
        }
        Check "HTTP 200 / Content-Type application/json [$($t.p)]" ($r.StatusCode -eq 200 -and $ct -match 'application/json') "status=$($r.StatusCode) ct=$ct"
        try {
            $raw = $r.Content | ConvertFrom-Json
            # 兼容 {code,status,data,...} 包装格式：若 .code==200 且 .data 存在，则解包 data
            if (($raw.PSObject.Properties.Name -contains 'code') -and ([int]$raw.code -ge 200 -and [int]$raw.code -lt 300) -and ($raw.PSObject.Properties.Name -contains 'data')) {
                $obj = $raw.data
            } else {
                $obj = $raw
            }
        } catch {
            Check "JSON parse OK [$($t.p)]" $false $_.Exception.Message
            continue
        }
        Check "JSON parse OK [$($t.p)]" $true
        if ($t.kind -eq 'array') {
            Check "返回是数组且非空 [$($t.p)]" ($obj -is [array] -and $obj.Count -gt 0) "type=$($obj.GetType().Name) count=$($obj.Count)"
        }
        if ($t.checkProp -ne $null) {
            try {
                $ok = & $t.checkProp $obj
                Check "字段契约 [$($t.must)]" $ok
            } catch {
                Check "字段契约 [$($t.must)]" $false $_.Exception.Message
            }
        }
    } catch {
        if ($t.noThrow -and $_.Exception.Response) {
            $sc = [int]$_.Exception.Response.StatusCode
            Check "waves/999 异常路径不 panic [$($t.p)]" ($sc -eq 404 -or $sc -ge 400) "status=$sc"
        } else {
            Check "Request OK [$($t.p)]" $false $_.Exception.Message
        }
    }
}

Write-Host ""
if ($FailCount -eq 0) {
    Write-Host "===== ALL PASS =====" -ForegroundColor Green
    exit 0
} else {
    Write-Host "===== $FailCount FAILURES =====" -ForegroundColor Red
    exit 1
}

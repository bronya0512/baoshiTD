# Tower Defense MVP v2 Contract Tests
# Use ASCII-only messages to avoid encoding parse errors under BOM-less UTF-8.

$Base = 'http://localhost:8080'
$FailCount = 0

function Check($name, $cond, $detail='') {
    if ($cond) {
        Write-Host ("[PASS] " + $name) -ForegroundColor Green
        if ($detail) { Write-Host ("       > " + $detail) }
    } else {
        Write-Host ("[FAIL] " + $name) -ForegroundColor Red
        if ($detail) { Write-Host ("       > " + $detail) }
        $script:FailCount++
    }
}

function CallAPI($path) {
    $r = Invoke-WebRequest -Uri ($Base + $path) -UseBasicParsing -TimeoutSec 5
    $raw = $r.Content | ConvertFrom-Json
    $props = @($raw.PSObject.Properties.Name)
    if (($props -contains 'code') -and ([int]$raw.code -ge 200 -and [int]$raw.code -lt 300) -and ($props -contains 'data')) {
        return @{ status = [int]$r.StatusCode; obj = $raw.data }
    }
    return @{ status = [int]$r.StatusCode; obj = $raw }
}

# ---------- 1. towers: 24 unique (rarity,element) ----------
try {
    $x = CallAPI '/api/config/towers'
    Check 'towers HTTP 200' ($x.status -eq 200)
    $towers = $x.obj
    Check 'towers.length == 24' ($towers.Count -eq 24) ('actual=' + $towers.Count)
    $seen = @{}
    foreach ($t in $towers) {
        $key = [string]$t.rarity + '#' + [string]$t.element
        if ($seen.ContainsKey($key)) {
            Check 'rarity+element unique across 24' $false ('dup=' + $key)
        } else {
            $seen[$key] = $true
        }
    }
    Check 'rarity+element unique count = 24' ($seen.Count -eq 24) ('count=' + $seen.Count)
    $badFields = @()
    foreach ($t in $towers) {
        if (-not ($t.levels -and $t.levels.Count -ge 1)) { $badFields += ('id=' + $t.id + ' no levels') ; continue }
        $L0 = $t.levels[0]
        if ($null -eq $L0.baseDamage -or [double]$L0.baseDamage -le 0) { $badFields += ('id=' + $t.id + ' bad baseDamage') }
        if ($null -eq $L0.attackRange -or [double]$L0.attackRange -le 0) { $badFields += ('id=' + $t.id + ' bad attackRange') }
        if ($null -eq $L0.attackSpeed -or [double]$L0.attackSpeed -le 0) { $badFields += ('id=' + $t.id + ' bad attackSpeed') }
        $isAOEProp = @($t.PSObject.Properties.Name) -contains 'isAOE'
        if (-not $isAOEProp) { $badFields += ('id=' + $t.id + ' missing isAOE') }
        $aoeRP = @($t.PSObject.Properties.Name) -contains 'aoeRadiusPx'
        if (-not $aoeRP) { $badFields += ('id=' + $t.id + ' missing aoeRadiusPx') }
    }
    if ($badFields.Count -gt 0) {
        Check 'towers fields ok (baseDamage/attackRange/attackSpeed/isAOE/aoeRadiusPx)' $false (($badFields[0..5] -join '; '))
    } else {
        Check 'towers fields ok (baseDamage/attackRange/attackSpeed/isAOE/aoeRadiusPx)' $true
    }
} catch { Check 'towers API' $false $_.Exception.Message }

# ---------- 2. luck ----------
try {
    $x = CallAPI '/api/config/luck'
    Check 'luck HTTP 200' ($x.status -eq 200)
    $l = $x.obj
    Check 'luck.initialLevel == 1' ([int]$l.initialLevel -eq 1)
    Check 'luck.levels.length >= 4' ($l.levels.Count -ge 4) ('actual=' + $l.levels.Count)
    $sorted = @($l.levels | Sort-Object -Property { [int]$_.level })
    $contig = $true
    for ($i=0; $i -lt $sorted.Count; $i++) {
        $expected = [int]$sorted[0].level + $i
        if ([int]$sorted[$i].level -ne $expected) { $contig = $false; break }
    }
    Check 'luck levels contiguous by level' $contig
    $lv1 = @($sorted | Where-Object { [int]$_.level -eq 1 })[0]
    $isNull = $false
    if ($null -eq $lv1.upgradeCostGold) { $isNull = $true }
    else {
        $v = $lv1.upgradeCostGold
        if ($v -is [string] -and $v -eq '') { $isNull = $true }
        if ($v -is [System.Management.Automation.PSCustomObject]) {
            if (@($v.PSObject.Properties.Name).Count -eq 0) { $isNull = $true }
        }
    }
    Check 'Lv1 upgradeCostGold is null' $isNull ('val=' + $lv1.upgradeCostGold)
    $weightOk = $true
    $bw = ''
    foreach ($sl in $sorted) {
        $tKeys = @($sl.towerRarityWeights.PSObject.Properties.Name)
        $bKeys = @($sl.bonusRarityWeights.PSObject.Properties.Name)
        if ($tKeys.Count -eq 0 -or $bKeys.Count -eq 0) { $weightOk = $false; $bw = 'level ' + $sl.level + ' empty keys'; break }
        $tSum = 0
        foreach ($k in $tKeys) { $tSum += [int]$sl.towerRarityWeights.$k }
        if ($tSum -le 0) { $weightOk = $false; $bw = 'level ' + $sl.level + ' tower sum=0'; break }
    }
    Check 'each level has towerRarityWeights + bonusRarityWeights with positive sum' $weightOk $bw
} catch { Check 'luck API' $false $_.Exception.Message }

# ---------- 3. buffs ----------
try {
    $x = CallAPI '/api/config/buffs'
    Check 'buffs HTTP 200' ($x.status -eq 200)
    $b = $x.obj
    Check 'buffs.rollCostGold > 0' ([int]$b.rollCostGold -gt 0) ('val=' + $b.rollCostGold)
    Check 'buffs.buffs.length >= 8' ($b.buffs.Count -ge 8) ('actual=' + $b.buffs.Count)
    $luckCall = CallAPI '/api/config/luck'
    $maxLuck = [int]$luckCall.obj.levels.Count
    $keys = @($b.rollRarityWeights.PSObject.Properties.Name)
    $keysInt = @($keys | ForEach-Object { [int]$_ } | Sort-Object)
    $ok = $true
    for ($i = 1; $i -le $maxLuck; $i++) {
        if ($i -notin $keysInt) { $ok = $false ; break }
    }
    Check ('buffs.rollRarityWeights covers 1..' + $maxLuck) $ok ('keys=' + ($keys -join ','))
} catch { Check 'buffs API' $false $_.Exception.Message }

# ---------- 4. waves/1 placementPerWave + rewardGold ----------
try {
    $x = CallAPI '/api/config/waves/1'
    Check 'waves/1 HTTP 200' ($x.status -eq 200)
    $w = $x.obj
    $bad = @()
    $idx = 0
    foreach ($wave in $w) {
        $idx++
        if ([int]$wave.placementPerWave -le 0) { $bad += ('wave#' + $idx + ' missing placementPerWave') }
        if ($null -eq $wave.rewardGold -or [int]$wave.rewardGold -lt 0) { $bad += ('wave#' + $idx + ' bad rewardGold') }
    }
    if ($bad.Count -gt 0) {
        Check 'waves placementPerWave + rewardGold per wave' $false ($bad[0..5] -join '; ')
    } else {
        Check 'waves placementPerWave + rewardGold per wave' $true ('count=' + $w.Count)
    }
} catch { Check 'waves API' $false $_.Exception.Message }

# ---------- 5. bad paths -> 4xx ----------
$badPaths = @('/api/config/waves/999', '/api/config/luck/999', '/api/config/buffs/999')
foreach ($bp in $badPaths) {
    try {
        $null = Invoke-WebRequest -Uri ($Base + $bp) -UseBasicParsing -TimeoutSec 5
        Check ('bad path returns 4xx ' + $bp) $false 'got 200'
    } catch {
        if ($_.Exception.Response) {
            $sc = [int]$_.Exception.Response.StatusCode
            Check ('bad path returns 4xx no panic ' + $bp) ($sc -ge 400 -and $sc -lt 500) ('status=' + $sc)
        } else {
            Check ('bad path returns 4xx no panic ' + $bp) $false $_.Exception.Message
        }
    }
}

# ---------- 6. maps/1 tiles int[] 384 ----------
try {
    $x = CallAPI '/api/config/maps/1'
    Check 'maps/1 HTTP 200' ($x.status -eq 200)
    $m = $x.obj
    Check 'maps/1 tiles length 384' ($m.tiles.Count -eq 384) ('actual=' + $m.tiles.Count)
    $allInt = $true
    foreach ($t in $m.tiles) {
        $okType = ($t -is [int]) -or ($t -is [double]) -or ($t -is [long]) -or ($t -is [decimal])
        if (-not $okType) { $allInt = $false; break }
    }
    Check 'maps/1 tiles all numbers (no base64 regression)' $allInt ('first type=' + $m.tiles[0].GetType().Name)
} catch { Check 'maps/1 API' $false $_.Exception.Message }

# ---------- 7. enemies killBaseGold + dropBonusRate ----------
try {
    $x = CallAPI '/api/config/enemies'
    Check 'enemies HTTP 200' ($x.status -eq 200)
    $es = $x.obj
    Check 'enemies.length >= 5' ($es.Count -ge 5) ('actual=' + $es.Count)
    $bad = @()
    for ($i=0; $i -lt [Math]::Min(5, $es.Count); $i++) {
        $e = $es[$i]
        if ($null -eq $e.killBaseGold -or [int]$e.killBaseGold -lt 0) { $bad += ('enemy#' + $e.id + ' bad killBaseGold') }
        if ($null -eq $e.dropBonusRate) { $bad += ('enemy#' + $e.id + ' missing dropBonusRate') }
    }
    if ($bad.Count -gt 0) {
        Check 'enemies have killBaseGold + dropBonusRate' $false ($bad -join '; ')
    } else {
        Check 'enemies have killBaseGold + dropBonusRate' $true
    }
} catch { Check 'enemies API' $false $_.Exception.Message }

Write-Host ''
if ($FailCount -eq 0) {
    Write-Host '===== v2 Contract ALL PASS =====' -ForegroundColor Green
    exit 0
} else {
    Write-Host ('===== v2 ' + $FailCount + ' FAILURES =====') -ForegroundColor Red
    exit 1
}

param(
  [string]$FallbackJs = ".\web\js\td-config-fallback.js",
  [string]$RefDir = ".\scripts\tmp"
)
$ErrorActionPreference = 'Stop'

function Check($name, $cond, $detail='') {
    if ($cond) { Write-Host "[PASS] $name" -ForegroundColor Green; if ($detail) { Write-Host "       > $detail" } }
    else      { Write-Host "[FAIL] $name" -ForegroundColor Red;   if ($detail) { Write-Host "       > $detail" }; $script:f++ }
}
function TopKeys($o) { if ($null -eq $o) { return @() }; return @($o.PSObject.Properties.Name | Sort-Object) }
function LoadRefData($basename) {
    return (Get-Content (Join-Path $RefDir "ref.$basename.data.json") -Raw) | ConvertFrom-Json
}
function TilesHash($tiles) {
    $sb = New-Object System.Text.StringBuilder
    foreach ($t in $tiles) { [void]$sb.Append($t) }
    $md5 = [System.Security.Cryptography.MD5]::Create()
    $bytes = [Text.Encoding]::UTF8.GetBytes($sb.ToString())
    return ([BitConverter]::ToString($md5.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
}

$f = 0

# Load fallback
$fbJson = $null
try {
    $sc = New-Object -ComObject MSScriptControl.ScriptControl -ErrorAction Stop
    $sc.Language = 'JScript'
    $sc.AddCode([IO.File]::ReadAllText((Resolve-Path $FallbackJs).Path)) | Out-Null
    $fbJson = $sc.Eval('JSON.stringify({towers:window.TD_FALLBACK_CONFIG.towers,enemies:window.TD_FALLBACK_CONFIG.enemies,gems:window.TD_FALLBACK_CONFIG.gems,mapsList:window.TD_FALLBACK_CONFIG.mapsList,map1:window.TD_FALLBACK_CONFIG.mapsDetail[1],waves1:window.TD_FALLBACK_CONFIG.waves[1]})')
} catch {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
        Write-Host "[SKIP] Node.js/MSScriptControl unavailable. Skipping fallback vs backend compare (files exist)." -ForegroundColor Yellow
        exit 0
    }
    $out = & node .\scripts\tmp\_fb_extract.js (Resolve-Path $FallbackJs).Path
    $fbJson = ($out -join "`n")
}
$fbObj = $fbJson | ConvertFrom-Json
$fb = @{
    towers   = $fbObj.towers
    enemies  = $fbObj.enemies
    gems     = $fbObj.gems
    mapsList = $fbObj.mapsList
    map1     = $fbObj.map1
    waves1   = $fbObj.waves1
}

# ============ towers ============
$r = LoadRefData 'towers'
Check ('towers count match ref=' + $r.Count + ' vs fb=' + $fb.towers.Count) ($r.Count -eq $fb.towers.Count)
$i = 0
$rk = TopKeys $r[$i]; $fk = @(TopKeys $fb.towers[$i])
$missing = @($rk | Where-Object { $_ -notin $fk })
Check 'towers[0] top-level keys match' ($missing.Count -eq 0) ('missing=' + ($missing -join ','))
$rl0 = TopKeys $r[$i].levels[0]; $fl0 = @(TopKeys $fb.towers[$i].levels[0])
$missL = @($rl0 | Where-Object { $_ -notin $fl0 })
Check 'towers[0].levels[0] keys match' ($missL.Count -eq 0) ('missing=' + ($missL -join ','))

# ============ enemies ============
$r = LoadRefData 'enemies'
Check ('enemies count match ref=' + $r.Count + ' vs fb=' + $fb.enemies.Count) ($r.Count -eq $fb.enemies.Count)
for ($j = 0; $j -lt [Math]::Min($r.Count, $fb.enemies.Count); $j++) {
    $rk = TopKeys $r[$j]; $fk = @(TopKeys $fb.enemies[$j])
    $missing = @($rk | Where-Object { $_ -notin $fk })
    Check ('enemies[' + $j + '] top-level keys match') ($missing.Count -eq 0) ('missing=' + ($missing -join ','))
}

# ============ gems ============
$r = LoadRefData 'gems'
$rk = TopKeys $r; $fk = @(TopKeys $fb.gems)
$missing = @($rk | Where-Object { $_ -notin $fk })
Check 'gems top-level keys match' ($missing.Count -eq 0) ('missing=' + ($missing -join ','))
Check ('gems.elements count match ref=' + $r.elements.Count + ' vs fb=' + $fb.gems.elements.Count) ($r.elements.Count -eq $fb.gems.elements.Count)
Check ('gems.rarities count match ref=' + $r.rarities.Count + ' vs fb=' + $fb.gems.rarities.Count) ($r.rarities.Count -eq $fb.gems.rarities.Count)
for ($j = 0; $j -lt [Math]::Min($r.elements.Count, $fb.gems.elements.Count); $j++) {
    $ek = @(TopKeys $r.elements[$j]); $fk2 = @(TopKeys $fb.gems.elements[$j])
    $m = @($ek | Where-Object { $_ -notin $fk2 })
    Check ('gems.elements[' + $j + '] keys match') ($m.Count -eq 0) ('missing=' + ($m -join ','))
}
Check ('gems.synthesisRules count match ref=' + $r.synthesisRules.Count + ' vs fb=' + $fb.gems.synthesisRules.Count) ($r.synthesisRules.Count -eq $fb.gems.synthesisRules.Count)

# ============ maps list ============
$r = LoadRefData 'maps'
Check ('mapsList count match ref=' + $r.Count + ' vs fb=' + $fb.mapsList.Count) ($r.Count -eq $fb.mapsList.Count)

# ============ maps/1 ============
$r = LoadRefData 'maps-1'
$rk = TopKeys $r; $fk = @(TopKeys $fb.map1)
$missing = @($rk | Where-Object { $_ -notin $fk })
Check 'maps/1 top-level keys match' ($missing.Count -eq 0) ('missing=' + ($missing -join ','))
Check ('maps/1 gridWidth ref=' + $r.gridWidth + ' fb=' + $fb.map1.gridWidth) ([int]$r.gridWidth -eq [int]$fb.map1.gridWidth)
Check ('maps/1 gridHeight ref=' + $r.gridHeight + ' fb=' + $fb.map1.gridHeight) ([int]$r.gridHeight -eq [int]$fb.map1.gridHeight)
Check ('maps/1 cellSize ref=' + $r.cellSize + ' fb=' + $fb.map1.cellSize) ([int]$r.cellSize -eq [int]$fb.map1.cellSize)
Check ('maps/1 base.hp ref=' + $r.base.hp + ' fb=' + $fb.map1.base.hp) ([int]$r.base.hp -eq [int]$fb.map1.base.hp)
Check ('maps/1 tiles length ref=' + $r.tiles.Count + ' fb=' + $fb.map1.tiles.Count) ($r.tiles.Count -eq $fb.map1.tiles.Count)
$hr = TilesHash $r.tiles; $hf = TilesHash $fb.map1.tiles
Check 'maps/1 tiles content hash match' ($hr -eq $hf) ('ref=' + $hr + '  fb=' + $hf)

# ============ waves/1 ============
$r = LoadRefData 'waves-1'
Check ('waves/1 count match ref=' + $r.Count + ' vs fb=' + $fb.waves1.Count) ($r.Count -eq $fb.waves1.Count)
for ($j = 0; $j -lt [Math]::Min($r.Count, $fb.waves1.Count); $j++) {
    Check ('waves/1[' + $j + '].groups count match') ($r[$j].groups.Count -eq $fb.waves1[$j].groups.Count)
}
Check 'waves/1[7] isBossWave==true' ([bool]$r[7].isBossWave -eq [bool]$fb.waves1[7].isBossWave)

Write-Host ''
if ($f -eq 0) { Write-Host '===== ALL PASS (fallback === backend contract) =====' -ForegroundColor Green; exit 0 }
else         { Write-Host ('===== ' + $f + ' FAILURES =====') -ForegroundColor Red; exit 1 }

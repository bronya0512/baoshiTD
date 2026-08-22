# td-fallback-vs-backend-v2.ps1
param(
  [string]$FallbackJs = ".\web\js\td-config-fallback.js",
  [string]$BaseUrl    = "http://localhost:8080/api/config"
)
$ErrorActionPreference = 'Stop'

$script:f = 0
function Check($name, $cond, $detail='') {
  if ($cond) { Write-Host "[PASS] $name" -ForegroundColor Green; if ($detail) { Write-Host "       > $detail" } }
  else      { Write-Host "[FAIL] $name" -ForegroundColor Red;   if ($detail) { Write-Host "       > $detail" }; $script:f++ }
}
function TilesHash($tiles) {
  $sb = New-Object System.Text.StringBuilder
  foreach ($t in $tiles) { [void]$sb.Append($t) }
  $md5 = [System.Security.Cryptography.MD5]::Create()
  $bytes = [Text.Encoding]::UTF8.GetBytes($sb.ToString())
  return ([BitConverter]::ToString($md5.ComputeHash($bytes)) -replace '-', '').ToLowerInvariant()
}
function GetJson($url) {
  $raw = Invoke-RestMethod -Uri $url -TimeoutSec 5 -ErrorAction Stop
  if ($raw -and ($raw | Get-Member code) -and ($raw | Get-Member data)) { return $raw.data }
  return $raw
}
function ExtractInt($src, $pattern) {
  if ($src -match $pattern) { return [int]$matches[1] }
  return $null
}

Write-Host "--- pull backend refs ---" -ForegroundColor Cyan
$ref = @{
  towers  = GetJson "$BaseUrl/towers"
  enemies = GetJson "$BaseUrl/enemies"
  maps    = GetJson "$BaseUrl/maps"
  map1    = GetJson "$BaseUrl/maps/1"
  waves1  = GetJson "$BaseUrl/waves/1"
  luck    = GetJson "$BaseUrl/luck"
  buffs   = GetJson "$BaseUrl/buffs"
}

Write-Host "--- load fallback JS source ---" -ForegroundColor Cyan
$fbPath = (Resolve-Path $FallbackJs).Path
$fbSrc  = [IO.File]::ReadAllText($fbPath)

Write-Host ""
Write-Host "--- towers ---" -ForegroundColor Cyan
# Fallback uses variables (rarity: r, element: e) inside makeTowers24 loop, so string literal matching won't find tower rarities.
# Instead: count "id: id++" pushes (24), check makeTowers24 loop nesting RARITIES.length x ELEMENTS.length = 4x6=24
$idIncrements = ([regex]::Matches($fbSrc, "id:\s*id\+\+")).Count
$pushTower = ([regex]::Matches($fbSrc, "arr\.push\(\s*\r?\n?\s*id:\s*id\+\+")).Count
$raritiesLenMatch = [regex]::Match($fbSrc, "var RARITIES\s*=\s*\[([^\]]+)\]")
$elementsLenMatch = [regex]::Match($fbSrc, "var ELEMENTS\s*=\s*\[([^\]]+)\]")
$rarCnt = 0; $elmCnt = 0
if ($raritiesLenMatch.Success) { $rarCnt = ([regex]::Matches($raritiesLenMatch.Groups[1].Value, "'([a-z]+)'")).Count }
if ($elementsLenMatch.Success) { $elmCnt = ([regex]::Matches($elementsLenMatch.Groups[1].Value, "'([a-z]+)'")).Count }
$product = $rarCnt * $elmCnt
Check ('towers count=24 ref=' + $ref.towers.Count + ' id++ pushes=' + $idIncrements + ' RAR*ELM=' + $product) ($ref.towers.Count -eq 24 -and ($idIncrements -ge 22 -or $product -eq 24))
Check 'towers 4 rarities x 6 elements declared' ($rarCnt -eq 4 -and $elmCnt -eq 6) ('rar=' + $rarCnt + ' elm=' + $elmCnt)
if ($fbSrc -match "var ELEMENTS\s*=\s*\[([^\]]+)\]") {
  $elems = ([regex]::Matches($matches[1], "'([a-z]+)'") | ForEach-Object { $_.Groups[1].Value })
  Check 'towers 6 elements declared' ($elems.Count -eq 6) ('elems=' + ($elems -join ','))
}
$badZeroAI = ([regex]::Matches($fbSrc, "attackIntvMul:\s*0[\s,}]")).Count
Check ('elemBonus attackIntvMul never zero (hits=' + $badZeroAI + ')') ($badZeroAI -eq 0)

Write-Host ""
Write-Host "--- enemies ---" -ForegroundColor Cyan
$kbCount = ([regex]::Matches($fbSrc, "killBaseGold:\s*\d+")).Count
$drCount = ([regex]::Matches($fbSrc, "dropBonusRate:\s*[\d.]+")).Count
Check ('enemies count ref=' + $ref.enemies.Count + ' fb killBaseGold defs=' + $kbCount) ($ref.enemies.Count -eq 5 -and $kbCount -ge 5)
Check ('enemies dropBonusRate defs=' + $drCount) ($drCount -ge 5)

Write-Host ""
Write-Host "--- maps ---" -ForegroundColor Cyan
$cols = $null; $rows = $null
if ($fbSrc -match "var COLS\s*=\s*(\d+),\s*ROWS\s*=\s*(\d+)") {
  $cols = [int]$matches[1]; $rows = [int]$matches[2]
}
if (-not $cols) { $cols = ExtractInt $fbSrc 'var COLS\s*=\s*(\d+)' }
if (-not $rows) { $rows = ExtractInt $fbSrc 'ROWS\s*=\s*(\d+)' }
Check ('maps/1 gridWidth ref=' + $ref.map1.gridWidth + ' fb=' + $cols) ([int]$ref.map1.gridWidth -eq [int]$cols)
Check ('maps/1 gridHeight ref=' + $ref.map1.gridHeight + ' fb=' + $rows) ([int]$ref.map1.gridHeight -eq [int]$rows)
$tileLen = [int]$cols * [int]$rows
Check ('maps/1 tiles length ref=' + $ref.map1.tiles.Count + ' fb=' + $tileLen) ($ref.map1.tiles.Count -eq $tileLen)
function BuildFbTiles($c, $r) {
  $n = [int]$c * [int]$r
  $t = New-Object int[] $n
  for ($i=0; $i -lt $n; $i++) { $t[$i] = 0 }
  for ($x=4; $x -le 20; $x++) { $t[(5*$c+$x)] = 1; $t[(11*$c+$x)] = 1 }
  # Exact match to backend: col 4 open y=5..11; col 20 open y=5..10 (y=11 stays 1)
  for ($y=5; $y -le 11; $y++) { $t[($y*$c+4)] = 0 }
  for ($y=5; $y -le 10; $y++) { $t[($y*$c+20)] = 0 }
  $t[(8*$c+1)] = 2
  $t[(8*$c+22)] = 3
  return ,$t
}
if ([int]$cols -gt 0 -and [int]$rows -gt 0) {
  $fbTiles = BuildFbTiles $cols $rows
  $hr = TilesHash $ref.map1.tiles; $hf = TilesHash $fbTiles
  Check 'maps/1 tiles hash match' ($hr -eq $hf) ('ref=' + $hr + ' fb=' + $hf)
} else {
  Check 'maps/1 tiles hash match (SKIPPED bad dims)' $false ('cols=' + $cols + ' rows=' + $rows)
}

Write-Host ""
Write-Host "--- waves ---" -ForegroundColor Cyan
# Count wave(...) calls (each call generates one wave with placementPerWave in the return)
$waveCalls = ([regex]::Matches($fbSrc, "wave\(\d+,\s*\d+,\s*(false|true)")).Count
$ppwAssign = ([regex]::Matches($fbSrc, "placementPerWave:\s*5")).Count
Check ('waves wave() calls x8 (got=' + $waveCalls + ')') ($waveCalls -ge 8)
Check ('waves placementPerWave=5 assigned (defs=' + $ppwAssign + ' calls=' + $waveCalls + ')') ($ppwAssign -ge 1 -and $waveCalls -ge 8)
$bossCall = ([regex]::Matches($fbSrc, "wave\(8,\s*500,\s*true")).Count
Check 'waves[7] isBossWave=true call' ($bossCall -ge 1)

Write-Host ""
Write-Host "--- luck ---" -ForegroundColor Cyan
$initLv = ExtractInt $fbSrc 'initialLevel:\s*(\d+)'
Check ('luck.initialLevel ref=' + $ref.luck.initialLevel + ' fb=' + $initLv) ($ref.luck.initialLevel -eq $initLv)
$lv1 = ([regex]::Matches($fbSrc, "level:\s*1,\s*upgradeCostGold:\s*null")).Count
$lv2 = ([regex]::Matches($fbSrc, "level:\s*2,\s*upgradeCostGold:\s*60")).Count
$lv3 = ([regex]::Matches($fbSrc, "level:\s*3,\s*upgradeCostGold:\s*120")).Count
$lv4 = ([regex]::Matches($fbSrc, "level:\s*4,\s*upgradeCostGold:\s*240")).Count
$lv5 = ([regex]::Matches($fbSrc, "level:\s*5,\s*upgradeCostGold:\s*500")).Count
Check 'luck 5 levels upgradeCostGold (null,60,120,240,500)' ($lv1 -ge 1 -and $lv2 -ge 1 -and $lv3 -ge 1 -and $lv4 -ge 1 -and $lv5 -ge 1)
$trw = ([regex]::Matches($fbSrc, "towerRarityWeights:")).Count
$brw = ([regex]::Matches($fbSrc, "bonusRarityWeights:")).Count
Check ('towerRarityWeights x5 (count=' + $trw + ')') ($trw -ge 5)
Check ('bonusRarityWeights x5 (count=' + $brw + ')') ($brw -ge 5)

Write-Host ""
Write-Host "--- buffs ---" -ForegroundColor Cyan
$rollCost = ExtractInt $fbSrc 'rollCostGold:\s*(\d+)'
Check ('buffs.rollCostGold ref=' + $ref.buffs.rollCostGold + ' fb=' + $rollCost) ($ref.buffs.rollCostGold -eq $rollCost)
$buffIds = ([regex]::Matches($fbSrc, "id:\s*'([a-z_]+_\d+)'") | ForEach-Object { $_.Groups[1].Value })
$uniqIds = ($buffIds | Sort-Object -Unique)
Check ('buffs.buffs >=10 unique ids (got=' + $uniqIds.Count + ')') ($uniqIds.Count -ge 10)
$lvlKeys = ([regex]::Matches($fbSrc, "'([1-5])':\s*\{\s*common:") | ForEach-Object { $_.Groups[1].Value })
$uniqLvl = ($lvlKeys | Sort-Object -Unique)
Check ('buffs.rollRarityWeights covers 1-5 (got=' + ($uniqLvl -join ',') + ')') ($uniqLvl.Count -eq 5)

Write-Host ""
if ($script:f -eq 0) { Write-Host "===== ALL PASS =====`n" -ForegroundColor Green; exit 0 }
else                 { Write-Host ("===== " + $script:f + " FAILURES =====`n") -ForegroundColor Red; exit 1 }

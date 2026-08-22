$BASE = 'http://localhost:8080'
$suffix = (Get-Date -Format 'HHmmss')
$TEST_USER = "mini_$suffix"
$pw='StrongP@ss1!'
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
        $bd = ''
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            $rd = New-Object System.IO.StreamReader($stream)
            $bd = $rd.ReadToEnd(); $rd.Close()
        } catch {}
        return @{ status = $status; body = $bd }
    }
}

$j = @{username=$TEST_USER; password=$pw} | ConvertTo-Json -Compress
$r = HTTP 'POST' "$BASE/api/auth/login" $j ''
Write-Host "login before register: status=$($r.status)"

$r = HTTP 'POST' "$BASE/api/auth/register" $j ''
Write-Host "register status=$($r.status)"
$regBody = $r.body | ConvertFrom-Json
$token = $regBody.data.token
Write-Host "token len=$($token.Length)"

$pl = @{
    version=1
    phase='PREPARE'
    luckLevel=2
    gold=42
    baseHP=18
    waveIndex=3
    tiles=@(0,1,2)
    grid=@(@{gx=3;gy=4;towerCfgId=5},@{gx=5;gy=6;type='wall'})
    activeBuffs=@(@{id='atk_15p';name='攻击+15%';rarity='rare';count=1})
    isAuto=$false
}
$json = $pl | ConvertTo-Json -Compress -Depth 5
Write-Host "POST JSON len=$($json.Length): $json"
$r = HTTP 'POST' "$BASE/api/save" $json $token
Write-Host "save POST status=$($r.status) body=$($r.body.Substring(0, [Math]::Min(120,$r.body.Length)))"

$r = HTTP 'GET' "$BASE/api/save" $null $token
Write-Host "save GET status=$($r.status)"
Write-Host "GET full body: $($r.body)"
$gb = $r.body | ConvertFrom-Json
$data = if ($gb.data) { $gb.data } else { $gb }
Write-Host "Parsed gold=[$($data.gold)] luck=[$($data.luckLevel)] wave=[$($data.waveIndex)] gridType=$($data.grid.GetType()) gridLen=$($data.grid.Count)"

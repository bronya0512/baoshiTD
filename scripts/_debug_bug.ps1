$BASE='http://localhost:8080'
$pw='123456'
$suffix = Get-Date -Format 'ssfff'
$u1="a_$suffix"; $u2="b_$suffix"

function Call($method,$url,$body,$token) {
    $h = @{}
    if ($token) { $h['Authorization'] = "Bearer $token" }
    try {
        if ($body) { $r = Invoke-RestMethod -Uri $url -Method $method -ContentType 'application/json' -Body $body -Headers $h -ErrorAction Stop }
        else       { $r = Invoke-RestMethod -Uri $url -Method $method -Headers $h -ErrorAction Stop }
        return [pscustomobject]@{s=200; b=$r}
    } catch {
        $st = 0
        try { $st = [int]$_.Exception.Response.StatusCode.value__ } catch {}
        return [pscustomobject]@{s=$st; b=$null}
    }
}

$b1 = @{username=$u1; password=$pw} | ConvertTo-Json -Compress
$r1 = Call 'POST' "$BASE/api/auth/register" $b1
Write-Host "reg1 s=$($r1.s) tokLen=$($r1.b.data.token.Length)"
$t1 = $r1.b.data.token

$sv = @{version=1; phase='WAVEEND'; luckLevel=3; gold=100; baseHP=10; waveIndex=5; grid=@(1,2,3)} | ConvertTo-Json -Compress -Depth 5
$null = Call 'POST' "$BASE/api/save" $sv $t1

$b2 = @{username=$u2; password=$pw} | ConvertTo-Json -Compress
$r2 = Call 'POST' "$BASE/api/auth/register" $b2
Write-Host "reg2 s=$($r2.s) tokLen=$($r2.b.data.token.Length)"
$t2 = $r2.b.data.token

$g2 = Call 'GET' "$BASE/api/save" $null $t2
Write-Host "user2 saveGET status=$($g2.s) code=$($g2.b.code) dataIsNull=$($g2.b.data -eq $null)"

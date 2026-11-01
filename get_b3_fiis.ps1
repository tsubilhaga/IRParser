. "$PSScriptRoot/b3_common.ps1"

Write-Host "Fetching FIIs from B3 API..."
$fiis = Get-AllB3Pages `
    -BaseUrl "https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedFundsSIG" `
    -Filters @{ typeFund = 7 } `
    -Label "FIIs"

$allAcronyms = $fiis | ForEach-Object { $_.acronym }

Write-Host "`nTotal FIIs found: $($allAcronyms.Count)"
$allAcronyms | Out-File -FilePath "b3_fiis_acronyms.txt"
Write-Host "`nResults have been saved to b3_fiis_acronyms.txt"

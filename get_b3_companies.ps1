. "$PSScriptRoot/b3_common.ps1"

Write-Host "Fetching companies from B3 API..."
$companies = Get-AllB3Pages `
    -BaseUrl "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies" `
    -Filters @{ language = "pt-br" } `
    -Label "companies"

$allCodeCVMs = $companies | ForEach-Object { $_.codeCVM }

Write-Host "`nTotal companies found: $($allCodeCVMs.Count)"
$allCodeCVMs | Out-File -FilePath "b3_companies_cvm.txt"
Write-Host "`nResults have been saved to b3_companies_cvm.txt"

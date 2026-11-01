. "$PSScriptRoot/b3_common.ps1"

function Get-CompanyDetails {
    param (
        [string]$CodeCVM
    )

    return Invoke-B3Request `
        -BaseUrl "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetDetail" `
        -Payload @{ codeCVM = $CodeCVM; language = "pt-br" } `
        -Label "company $CodeCVM"
}

function Get-FIIDetails {
    param (
        [string]$IdentifierFund
    )

    return Invoke-B3Request `
        -BaseUrl "https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetDetailFundSIG" `
        -Payload @{ typeFund = 7; identifierFund = $IdentifierFund } `
        -Label "FII $IdentifierFund"
}

$result = @{}

Write-Host "Processing companies..."
$companies = Get-Content "b3_companies_cvm.txt"

foreach ($codeCVM in $companies) {
    Write-Host "Processing company with CVM code: $codeCVM"
    $details = Get-CompanyDetails -CodeCVM $codeCVM
    
    if ($details) {
        $key = if ($details.code) { $details.code } else { $details.issuingCompany }
        
        if ($key) {
            $result[$key] = @{
                name = $details.companyName
                cnpj = $details.cnpj
                type = 'AÇÃO'
            }
        }
        else {
            Write-Warning "No code or issuingCompany found for company with CVM code: $($codeCVM)"
        }
        
        if ($details.otherCodes) {
            foreach ($otherCode in $details.otherCodes) {
                if ($otherCode.code) {
                    $result[$otherCode.code] = @{
                        name = $details.companyName
                        cnpj = $details.cnpj
                        type = 'AÇÃO'
                    }
                }
            }
        }
    }
    
    Start-Sleep -Milliseconds 1000
}

Write-Host "`nProcessing FIIs..."
$fiis = Get-Content "b3_fiis_acronyms.txt"

foreach ($acronym in $fiis) {
    Write-Host "Processing FII: $acronym"
    $details = Get-FIIDetails -IdentifierFund $acronym
    
    if ($details) {
        $fundDetails = $details.detailFund
        
        if ($fundDetails.codes) {
            foreach ($code in $fundDetails.codes) {
                if ($code) {
                    $result[$code.Trim()] = @{
                        name = $fundDetails.companyName.Trim()
                        cnpj = $fundDetails.cnpj
                        type = 'FII'
                    }
                }
            }
        }
        elseif ($fundDetails.tradingCode) {
            $result[$fundDetails.tradingCode.Trim()] = @{
                name = $fundDetails.companyName.Trim()
                cnpj = $fundDetails.cnpj
                type = 'FII'
            }
        }
        else {
            $result[$acronym] = @{
                name = $fundDetails.companyName.Trim()
                cnpj = $fundDetails.cnpj
                type = 'FII'
            }
        }
        
        if ($fundDetails.codesOther) {
            foreach ($otherCode in $fundDetails.codesOther) {
                if ($otherCode) {
                    $result[$otherCode.Trim()] = @{
                        name = $fundDetails.companyName.Trim()
                        cnpj = $fundDetails.cnpj
                        type = 'FII'
                    }
                }
            }
        }
    }
    
    Start-Sleep -Milliseconds 1000
}

$jsonResult = $result | ConvertTo-Json -Depth 10
# Grava sem BOM para o arquivo poder ser importado direto pelo frontend
$outputPath = Join-Path (Get-Location) "b3_companies_and_fiis_details.json"
[System.IO.File]::WriteAllText($outputPath, $jsonResult, [System.Text.UTF8Encoding]::new($false))
Write-Host "`nResults have been saved to b3_companies_and_fiis_details.json" 
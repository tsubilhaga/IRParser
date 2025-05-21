
function ConvertTo-Base64 {
    param (
        [string]$JsonString
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonString)
    return [Convert]::ToBase64String($bytes)
}

function Get-CompanyDetails {
    param (
        [string]$CodeCVM,
        [int]$MaxRetries = 5,
        [int]$InitialDelaySeconds = 5
    )

    $payload = @{
        codeCVM = $CodeCVM
        language = "pt-br"
    } | ConvertTo-Json

    $base64Payload = ConvertTo-Base64 -JsonString $payload

    $url = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetDetail/$base64Payload"

    $retryCount = 0
    $delaySeconds = $InitialDelaySeconds

    while ($retryCount -lt $MaxRetries) {
        try {
            $response = Invoke-RestMethod -Uri $url -Method Get
            
            if ($null -eq $response) {
                Write-Warning "Empty response received for company $($CodeCVM)"
                return $null
            }

            return $response
        }
        catch {
            $errorMessage = $_.Exception.Message
            Write-Warning "Attempt $($retryCount + 1) of $($MaxRetries) failed for company $($CodeCVM): $errorMessage"
            
            if ($errorMessage -match "error code: 1015") {
                $retryCount++
                if ($retryCount -lt $MaxRetries) {
                    Write-Host "Rate limit detected. Waiting $($delaySeconds) seconds before retry..."
                    Start-Sleep -Seconds $delaySeconds
                    $delaySeconds *= 2
                }
                else {
                    Write-Error "Maximum retry attempts reached for company $($CodeCVM)"
                    return $null
                }
            }
            else {
                Write-Error "Unexpected error for company $($CodeCVM): $errorMessage"
                return $null
            }
        }
    }
}

function Get-FIIDetails {
    param (
        [string]$IdentifierFund,
        [int]$MaxRetries = 5,
        [int]$InitialDelaySeconds = 5
    )

    $payload = @{
        typeFund = 7
        identifierFund = $IdentifierFund
    } | ConvertTo-Json

    $base64Payload = ConvertTo-Base64 -JsonString $payload

    $url = "https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetDetailFundSIG/$base64Payload"

    $retryCount = 0
    $delaySeconds = $InitialDelaySeconds

    while ($retryCount -lt $MaxRetries) {
        try {
            $response = Invoke-RestMethod -Uri $url -Method Get
            
            if ($null -eq $response) {
                Write-Warning "Empty response received for FII $($IdentifierFund)"
                return $null
            }

            return $response
        }
        catch {
            $errorMessage = $_.Exception.Message
            Write-Warning "Attempt $($retryCount + 1) of $($MaxRetries) failed for FII $($IdentifierFund): $errorMessage"
            
            if ($errorMessage -match "error code: 1015") {
                $retryCount++
                if ($retryCount -lt $MaxRetries) {
                    Write-Host "Rate limit detected. Waiting $($delaySeconds) seconds before retry..."
                    Start-Sleep -Seconds $delaySeconds
                    $delaySeconds *= 2
                }
                else {
                    Write-Error "Maximum retry attempts reached for FII $($IdentifierFund)"
                    return $null
                }
            }
            else {
                Write-Error "Unexpected error for FII $($IdentifierFund): $errorMessage"
                return $null
            }
        }
    }
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
$jsonResult | Out-File -FilePath "b3_companies_and_fiis_details.json" -Encoding UTF8
Write-Host "`nResults have been saved to b3_companies_and_fiis_details.json" 

function ConvertTo-Base64 {
    param (
        [string]$JsonString
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonString)
    return [Convert]::ToBase64String($bytes)
}

function Get-B3Companies {
    param (
        [int]$PageNumber = 1,
        [int]$PageSize = 20,
        [int]$MaxRetries = 5,
        [int]$InitialDelaySeconds = 5
    )

    $payload = @{
        language = "pt-br"
        pageNumber = $PageNumber
        pageSize = $PageSize
    } | ConvertTo-Json

    $base64Payload = ConvertTo-Base64 -JsonString $payload

    $url = "https://sistemaswebb3-listados.b3.com.br/listedCompaniesProxy/CompanyCall/GetInitialCompanies/$base64Payload"

    $retryCount = 0
    $delaySeconds = $InitialDelaySeconds

    while ($retryCount -lt $MaxRetries) {
        try {
            $response = Invoke-RestMethod -Uri $url -Method Get
            return $response
        }
        catch {
            $errorMessage = $_.Exception.Message
            Write-Warning "Attempt $($retryCount + 1) of $MaxRetries failed: $errorMessage"
            
            if ($errorMessage -match "error code: 1015") {
                $retryCount++
                if ($retryCount -lt $MaxRetries) {
                    Write-Host "Rate limit detected. Waiting $delaySeconds seconds before retry..."
                    Start-Sleep -Seconds $delaySeconds
                    $delaySeconds *= 2
                }
                else {
                    Write-Error "Maximum retry attempts reached. Moving to next page."
                    return $null
                }
            }
            else {
                Write-Error "Unexpected error: $errorMessage"
                return $null
            }
        }
    }
}

$allCodeCVMs = @()
$currentPage = 1
$totalPages = 1
$failedPages = @()

Write-Host "Fetching companies from B3 API..."

do {
    Write-Host "Fetching page $currentPage of $totalPages..."
    
    $response = Get-B3Companies -PageNumber $currentPage
    
    if ($response) {
        if ($currentPage -eq 1) {
            $totalPages = $response.page.totalPages
        }
        
        $codeCVMs = $response.results | ForEach-Object { $_.codeCVM }
        $allCodeCVMs += $codeCVMs
        
        $currentPage++
    }
    else {
        Write-Warning "Failed to fetch page $currentPage - will retry later"
        $failedPages += $currentPage
        $currentPage++
    }
    
    Start-Sleep -Milliseconds 1000
    
} while ($currentPage -le $totalPages)

if ($failedPages.Count -gt 0) {
    Write-Host "`nRetrying failed pages..."
    foreach ($page in $failedPages) {
        Write-Host "Retrying page $page..."
        $response = Get-B3Companies -PageNumber $page -InitialDelaySeconds 10
        
        if ($response) {
            $codeCVMs = $response.results | ForEach-Object { $_.codeCVM }
            $allCodeCVMs += $codeCVMs
            Write-Host "Successfully retrieved page $page"
        }
        else {
            Write-Error "Failed to retrieve page $page after retry"
        }
        
        Start-Sleep -Seconds 2
    }
}

Write-Host "`nTotal companies found: $($allCodeCVMs.Count)"
Write-Host "`nAll codeCVM values:"
$allCodeCVMs | ForEach-Object { Write-Host $_ }

$allCodeCVMs | Out-File -FilePath "b3_companies_cvm.txt"
Write-Host "`nResults have been saved to b3_companies_cvm.txt" 
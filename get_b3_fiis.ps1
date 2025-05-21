function ConvertTo-Base64 {
    param (
        [string]$JsonString
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonString)
    return [Convert]::ToBase64String($bytes)
}

function Get-B3FIIs {
    param (
        [int]$PageNumber = 1,
        [int]$PageSize = 20,
        [int]$MaxRetries = 5,
        [int]$InitialDelaySeconds = 5
    )

    $payload = @{
        typeFund = 7
        pageNumber = $PageNumber
        pageSize = $PageSize
    } | ConvertTo-Json

    $base64Payload = ConvertTo-Base64 -JsonString $payload

    $url = "https://sistemaswebb3-listados.b3.com.br/fundsProxy/fundsCall/GetListedFundsSIG/$base64Payload"

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

$allAcronyms = @()
$currentPage = 1
$totalPages = 1
$failedPages = @()

Write-Host "Fetching FIIs from B3 API..."

do {
    Write-Host "Fetching page $currentPage of $totalPages..."
    
    $response = Get-B3FIIs -PageNumber $currentPage
    
    if ($response) {
        if ($currentPage -eq 1) {
            $totalPages = $response.page.totalPages
        }
        
        $acronyms = $response.results | ForEach-Object { $_.acronym }
        $allAcronyms += $acronyms
        
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
        $response = Get-B3FIIs -PageNumber $page -InitialDelaySeconds 10
        
        if ($response) {
            $acronyms = $response.results | ForEach-Object { $_.acronym }
            $allAcronyms += $acronyms
            Write-Host "Successfully retrieved page $page"
        }
        else {
            Write-Error "Failed to retrieve page $page after retry"
        }
        
        Start-Sleep -Seconds 2
    }
}

Write-Host "`nTotal FIIs found: $($allAcronyms.Count)"
Write-Host "`nAll FII acronyms:"
$allAcronyms | ForEach-Object { Write-Host $_ }

$allAcronyms | Out-File -FilePath "b3_fiis_acronyms.txt"
Write-Host "`nResults have been saved to b3_fiis_acronyms.txt" 
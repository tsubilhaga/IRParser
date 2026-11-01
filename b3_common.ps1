function ConvertTo-Base64 {
    param (
        [string]$JsonString
    )
    $bytes = [System.Text.Encoding]::UTF8.GetBytes($JsonString)
    return [Convert]::ToBase64String($bytes)
}

# Chama a API da B3 e repete a chamada apenas quando há limite de requisições
function Invoke-B3Request {
    param (
        [string]$BaseUrl,
        [hashtable]$Payload,
        [string]$Label,
        [int]$MaxRetries = 5,
        [int]$InitialDelaySeconds = 5
    )

    $base64Payload = ConvertTo-Base64 -JsonString ($Payload | ConvertTo-Json)
    $url = "$BaseUrl/$base64Payload"

    $retryCount = 0
    $delaySeconds = $InitialDelaySeconds

    while ($retryCount -lt $MaxRetries) {
        try {
            $response = Invoke-RestMethod -Uri $url -Method Get

            if ($null -eq $response) {
                Write-Warning "Empty response received for $Label"
            }

            return $response
        }
        catch {
            $errorMessage = $_.Exception.Message
            Write-Warning "Attempt $($retryCount + 1) of $MaxRetries failed for ${Label}: $errorMessage"

            if ($errorMessage -match "error code: 1015") {
                $retryCount++
                if ($retryCount -lt $MaxRetries) {
                    Write-Host "Rate limit detected. Waiting $delaySeconds seconds before retry..."
                    Start-Sleep -Seconds $delaySeconds
                    $delaySeconds *= 2
                }
                else {
                    Write-Error "Maximum retry attempts reached for $Label"
                    return $null
                }
            }
            else {
                Write-Error "Unexpected error for ${Label}: $errorMessage"
                return $null
            }
        }
    }
}

# Baixa todas as páginas ou lança erro. Assim, uma falha nunca grava uma lista parcial.
function Get-AllB3Pages {
    param (
        [string]$BaseUrl,
        [hashtable]$Filters,
        [string]$Label
    )

    function Get-Page([int]$Number) {
        $payload = $Filters + @{ pageNumber = $Number; pageSize = 20 }
        $response = Invoke-B3Request -BaseUrl $BaseUrl -Payload $payload -Label "$Label page $Number"
        if (-not $response) {
            Write-Host "Retrying page $Number..."
            Start-Sleep -Seconds 2
            $response = Invoke-B3Request -BaseUrl $BaseUrl -Payload $payload -Label "$Label page $Number" -InitialDelaySeconds 10
        }
        if (-not $response) {
            throw "Failed to retrieve $Label page $Number. Nothing was saved."
        }
        return $response
    }

    $first = Get-Page 1
    $totalPages = $first.page.totalPages
    $items = @($first.results)
    for ($number = 2; $number -le $totalPages; $number++) {
        Write-Host "Fetching page $number of $totalPages..."
        Start-Sleep -Milliseconds 1000
        $items += @((Get-Page $number).results)
    }

    if ($items.Count -eq 0) {
        throw "B3 returned no $Label. Nothing was saved."
    }
    return $items
}

function Send-Wager {
  param([string]$Key, [string]$BodyPath)

  try {
    $response = Invoke-WebRequest -Method Post `
      -Uri http://localhost:3000/wagering/transactions `
      -ContentType 'application/json' `
      -Headers @{ 'Idempotency-Key' = $Key } `
      -Body (Get-Content $BodyPath -Raw)

    "$([int]$response.StatusCode) $($response.Content)"
  }
  catch {
    $status = [int]$_.Exception.Response.StatusCode
    $reader = New-Object System.IO.StreamReader(
      $_.Exception.Response.GetResponseStream()
    )
    "$status $($reader.ReadToEnd())"
  }
}
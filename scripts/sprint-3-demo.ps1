param(
  [Parameter(Mandatory = $true)]
  [ValidateNotNullOrEmpty()]
  [string] $ClassCode,

  [switch] $OpenBrowser
)

$ErrorActionPreference = 'Stop'

$repoRoot = Split-Path -Parent $PSScriptRoot
$outputDirectory = Join-Path $repoRoot 'run\sprint-3-demo'
$timestamp = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$studentCode1 = [string] $timestamp
$studentCode2 = [string] ($timestamp + 1)
$csvPath = Join-Path $outputDirectory "students-$timestamp.csv"

function Test-DemoEndpoint {
  param(
    [Parameter(Mandatory = $true)]
    [string] $Name,

    [Parameter(Mandatory = $true)]
    [string] $Url
  )

  try {
    $response = Invoke-WebRequest -Uri $Url -Method Get -UseBasicParsing
    Write-Host "[OK] $Name phản hồi HTTP $($response.StatusCode): $Url"
  }
  catch {
    throw "$Name chưa sẵn sàng tại $Url. Hãy khởi động môi trường local trước khi demo."
  }
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null

$rows = @(
  [pscustomobject]@{
    studentCode = $studentCode1
    fullName = 'Sinh viên Demo Một'
    email = "demo.$studentCode1@example.edu.vn"
    classCode = $ClassCode
  }
  [pscustomobject]@{
    studentCode = $studentCode2
    fullName = 'Sinh viên Demo Hai'
    email = "demo.$studentCode2@example.edu.vn"
    classCode = $ClassCode
  }
)

$rows | Export-Csv -Path $csvPath -NoTypeInformation -Encoding utf8

Test-DemoEndpoint -Name 'API' -Url 'http://localhost:3000/services?status=ACTIVE'
Test-DemoEndpoint -Name 'Web' -Url 'http://localhost:3001/admin/login'

Write-Host ''
Write-Host "File import demo: $csvPath"
Write-Host 'Trang Import: http://localhost:3001/admin/students/import'
Write-Host 'Trang Audit log: http://localhost:3001/admin/audit-logs'
Write-Host 'Mailpit: http://localhost:8025'
Write-Host 'Runbook: docs/sprint-3-demo-runbook.md'

if ($OpenBrowser) {
  Start-Process 'http://localhost:3001/admin/students/import'
  Start-Process 'http://localhost:8025'
}

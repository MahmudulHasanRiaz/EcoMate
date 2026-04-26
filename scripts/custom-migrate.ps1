$lines = Get-Content .env
foreach ($line in $lines) {
  if ($line -match '^(?!#)\s*([^=]+)=(.*)\s*$') {
    $name=$matches[1].Trim()
    $value=$matches[2].Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"')) { $value=$value.Substring(1, $value.Length-2) }
    [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
  }
}
Write-Host "Environment variables loaded."
$argsStr = $args -join " "
Write-Host "Running: npx prisma migrate $argsStr"
# Using cmd /c to ensure npx is found and executed correctly in the same environment
$cmd = "npx prisma migrate $argsStr"
Invoke-Expression $cmd

$lines = Get-Content .env
foreach ($line in $lines) {
    if ($line -match '^(?!#)\s*([^=]+)=(.*)\s*$') {
        $name = $matches[1].Trim()
        $value = $matches[2].Trim()
        if ($value.StartsWith('"') -and $value.EndsWith('"')) { $value = $value.Substring(1, $value.Length - 2) }
        [System.Environment]::SetEnvironmentVariable($name, $value, 'Process')
    }
}
Write-Host "Environment variables loaded."
$argsStr = $args -join " "
Write-Host "Running: npx prisma $argsStr"
$cmd = "npx prisma $argsStr"
Invoke-Expression $cmd

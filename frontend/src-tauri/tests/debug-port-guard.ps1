# Checks whether an app binary was built with the WebView2 debugging port. The window config,
# browser arguments included, is embedded in the exe as plain text. On Windows CI the shipped build
# must not have it, and the storage-test variant must (which proves the search finds it).

param(
    [Parameter(Mandatory = $true)][string]$Exe,
    [Parameter(Mandatory = $true)][ValidateSet('absent', 'present')][string]$Expect
)
$ErrorActionPreference = 'Stop'
$text = [Text.Encoding]::ASCII.GetString([IO.File]::ReadAllBytes((Resolve-Path -LiteralPath $Exe).Path))
$found = $text.Contains('--remote-debugging-port')
if ($found -ne ($Expect -eq 'present')) {
    throw "FAIL: $Exe $(if ($found) { 'has' } else { 'lacks' }) the WebView2 debugging port, expected $Expect."
}
Write-Host "ok - $Exe : debugging port $Expect"

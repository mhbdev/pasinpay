$ErrorActionPreference = "Stop"

function Invoke-Checked {
	param(
		[string]$Command,
		[string[]]$Arguments
	)

	& $Command @Arguments
	if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}

Invoke-Checked "bun" @("run", "check-types")
Invoke-Checked "bun" @("run", "test")
Invoke-Checked "bun" @("run", "build")
Invoke-Checked "powershell" @(
	"-NoProfile",
	"-ExecutionPolicy",
	"Bypass",
	"-File",
	(Join-Path $PSScriptRoot "test-contracts.ps1")
)

Write-Output "All local application and contract checks passed."

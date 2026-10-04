$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$contractsPath = Join-Path $repoRoot "contracts"
$forge = Get-Command forge -ErrorAction SilentlyContinue

if ($forge) {
	Push-Location $contractsPath
	try {
		& forge test -vv
		if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
	} finally {
		Pop-Location
	}
	exit 0
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
	throw "Foundry is not installed and Docker is unavailable. Install Foundry or Docker Desktop, then rerun this script."
}

& docker run --rm -v "${contractsPath}:/src" -w /src ghcr.io/foundry-rs/foundry:latest "forge test -vv"
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

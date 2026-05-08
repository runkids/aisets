param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\Asset Studio"),
  [switch]$SkipOcrEngine,
  [switch]$InstallOcrEngine,
  [string]$Repo = $(if ($env:ASSET_STUDIO_REPO) { $env:ASSET_STUDIO_REPO } else { "runkids/asset-studio" })
)

$ErrorActionPreference = "Stop"

if ($SkipOcrEngine -and $InstallOcrEngine) {
  throw "Use only one of -SkipOcrEngine or -InstallOcrEngine."
}

$BinaryName = "asset-studio"
$ExeName = "$BinaryName.exe"

function Add-DirectoryToUserPath {
  param([string]$Directory)

  if (-not $Directory -or -not (Test-Path $Directory)) {
    return
  }

  $normalized = [System.IO.Path]::GetFullPath($Directory).TrimEnd('\')
  $current = [Environment]::GetEnvironmentVariable("Path", "User")
  $parts = @()
  if ($current) {
    $parts = $current -split ';' | Where-Object { $_ }
  }

  $alreadyPresent = $false
  foreach ($part in $parts) {
    if ([System.IO.Path]::GetFullPath($part).TrimEnd('\').Equals($normalized, [System.StringComparison]::OrdinalIgnoreCase)) {
      $alreadyPresent = $true
      break
    }
  }

  if (-not $alreadyPresent) {
    $next = if ($current) { "$current;$normalized" } else { $normalized }
    [Environment]::SetEnvironmentVariable("Path", $next, "User")
    Write-Host "Added to user PATH: $normalized"
  }

  $envParts = $env:Path -split ';' | Where-Object { $_ }
  $inCurrentProcess = $false
  foreach ($part in $envParts) {
    if ([System.IO.Path]::GetFullPath($part).TrimEnd('\').Equals($normalized, [System.StringComparison]::OrdinalIgnoreCase)) {
      $inCurrentProcess = $true
      break
    }
  }
  if (-not $inCurrentProcess) {
    $env:Path = "$normalized;$env:Path"
  }
}

function Get-AssetStudioArch {
  switch ([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture) {
    "X64" { return "amd64" }
    "Arm64" { return "arm64" }
    default { throw "Unsupported architecture: $([System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture)" }
  }
}

function Test-TesseractCommand {
  return [bool](Get-Command "tesseract.exe" -ErrorAction SilentlyContinue)
}

function Find-KnownTesseractPath {
  $candidates = @(
    (Join-Path $env:ProgramFiles "Tesseract-OCR\tesseract.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Tesseract-OCR\tesseract.exe"),
    (Join-Path $env:LOCALAPPDATA "Programs\Tesseract-OCR\tesseract.exe")
  )

  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }
  return $null
}

function Confirm-TesseractInstall {
  if ($InstallOcrEngine) {
    return $true
  }

  try {
    $answer = Read-Host "Install local OCR engine dependency (Tesseract) for image text search? [Y/n]"
  } catch {
    Write-Host "Skipping OCR engine install because no interactive prompt is available. Re-run with -InstallOcrEngine to install it."
    return $false
  }

  return -not ($answer -match '^(?i:n|no)$')
}

function Install-Tesseract {
  if ($SkipOcrEngine) {
    Write-Host "Skipping OCR engine install because -SkipOcrEngine was provided."
    return
  }

  if (Test-TesseractCommand) {
    Write-Host "OCR engine already installed: $((Get-Command tesseract.exe).Source)"
    return
  }

  if (-not (Confirm-TesseractInstall)) {
    Write-Host "Skipping OCR engine install. OCR cache build will stay disabled until tesseract is installed."
    return
  }

  Write-Host "Installing OCR engine dependency: tesseract"
  if (Get-Command "winget.exe" -ErrorAction SilentlyContinue) {
    winget install --id UB-Mannheim.TesseractOCR --exact --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      throw "winget failed to install Tesseract."
    }
  } elseif (Get-Command "choco.exe" -ErrorAction SilentlyContinue) {
    choco install tesseract -y
    if ($LASTEXITCODE -ne 0) {
      throw "Chocolatey failed to install Tesseract."
    }
  } else {
    throw "No supported Windows package manager found. Install winget or Chocolatey, then re-run this installer."
  }

  $knownPath = Find-KnownTesseractPath
  if ($knownPath) {
    Add-DirectoryToUserPath (Split-Path $knownPath -Parent)
  }

  if (Test-TesseractCommand) {
    Write-Host "Installed OCR engine: $((Get-Command tesseract.exe).Source)"
  } else {
    throw "Tesseract install finished but tesseract.exe is still not on PATH. Restart the terminal or add the Tesseract-OCR directory to PATH."
  }
}

$arch = Get-AssetStudioArch
try {
  $latest = Invoke-RestMethod -Uri "https://api.github.com/repos/$Repo/releases/latest"
} catch {
  throw "No GitHub release found for $Repo. Create the GitHub repo and publish a release first, or pass -Repo owner/name for a different repo."
}
$tag = $latest.tag_name
if (-not $tag) {
  throw "Latest release tag is empty."
}
$version = $tag.TrimStart('v')
$archive = "${BinaryName}_${version}_windows_${arch}.zip"
$asset = $latest.assets | Where-Object { $_.name -eq $archive } | Select-Object -First 1
$url = if ($asset) { $asset.browser_download_url } else { "https://github.com/$Repo/releases/download/$tag/$archive" }
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) ([System.Guid]::NewGuid().ToString())
New-Item -ItemType Directory -Path $tmp | Out-Null

try {
  $archivePath = Join-Path $tmp $archive
  Write-Host "Downloading $url"
  Invoke-WebRequest -Uri $url -OutFile $archivePath
  Expand-Archive -Path $archivePath -DestinationPath $tmp -Force

  New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
  Copy-Item -Path (Join-Path $tmp $ExeName) -Destination (Join-Path $InstallDir $ExeName) -Force
  Add-DirectoryToUserPath $InstallDir

  Install-Tesseract

  $installed = Join-Path $InstallDir $ExeName
  Write-Host "Installed $(& $installed version) to $installed"
} finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

param(
  [string]$InstallDir = (Join-Path $env:LOCALAPPDATA "Programs\Aisets"),
  [string]$Repo = $(if ($env:AISETS_REPO) { $env:AISETS_REPO } else { "runkids/aisets" })
)

$ErrorActionPreference = "Stop"

$BinaryName = "aisets"
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

  $installed = Join-Path $InstallDir $ExeName
  Write-Host "Installed $(& $installed version) to $installed"
} finally {
  Remove-Item -Path $tmp -Recurse -Force -ErrorAction SilentlyContinue
}

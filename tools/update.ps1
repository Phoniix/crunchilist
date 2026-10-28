# Manual Kivori SekAI update, for when Update now in Settings can't finish. Double-click update.cmd in the
# Kivori SekAI folder. Your list and settings are kept by Chrome, not in this folder, so they stay.
# Must stay plain ASCII: Windows PowerShell 5.1 reads scripts without a BOM as the local code page.
param(
  [string]$Root = (Split-Path -Parent $PSScriptRoot),
  [string]$Zip = "",
  [switch]$Force,
  [switch]$NoPause,
  [int]$SettleMs = 1500,
  [string]$Repo = "Phoniix/crunchilist",
  [string]$ApiBase = "https://api.github.com"
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
# Same lists as PACKAGE_FOLDERS and PACKAGE_ROOT_FILES in lib/update-files.js (tests/manual-update.test.js checks).
$Folders = @("app", "background", "feeds", "fonts", "icons", "lib", "options", "popup", "tools", "ui")
$RootFiles = @("update.cmd", "install.cmd", "INSTALL.txt")
$AppName = "Kivori SekAI"
$Latin1 = [Text.Encoding]::GetEncoding(28591)
$Utf8 = New-Object Text.UTF8Encoding $false

function Finish([int]$code) {
  if (-not $NoPause) { Write-Host ""; [void](Read-Host "Press Enter to close") }
  exit $code
}

function Local([string]$base, [string]$file) { Join-Path $base ($file.Replace("/", "\")) }

function ReadManifest([string]$path) { [IO.File]::ReadAllText($path, $Utf8) | ConvertFrom-Json }

function ContentFiles($manifest) {
  $out = @()
  foreach ($entry in @($manifest.content_scripts)) {
    if ($entry) { $out += @($entry.js) + @($entry.css) }
  }
  # Same site scripts as contentFiles() in lib/update-files.js (injected, not listed in content_scripts).
  $out += @(
    "content/site-panel.js",
    "content/site/key-guard.js",
    "content/site/return.js",
    "content/site/crunchyroll.js",
    "content/site/crunchyroll-page.js",
    "content/site/netflix.js",
    "content/site/netflix-page.js",
    "content/site/prime.js",
    "content/site/hidive.js",
    "content/site/hidive-page.js",
    "content/site/tubi.js",
    "content/site/tubi-page.js"
  )
  @($out | Where-Object { $_ } | Select-Object -Unique)
}

function IsPackagePath([string]$file, $content) {
  if ($file -cnotmatch '^[A-Za-z0-9_.-]+(/[A-Za-z0-9_.-]+)*$') { return $false }
  $parts = $file -split "/"
  if ($parts -contains "." -or $parts -contains "..") { return $false }
  if ($file -eq "manifest.json" -or $RootFiles -contains $file -or $content -contains $file) { return $true }
  if ($file.EndsWith(".test.js")) { return $false }
  foreach ($folder in $Folders) { if ($file.StartsWith("$folder/")) { return $true } }
  $false
}

function Text([string]$path) { $Latin1.GetString([IO.File]::ReadAllBytes($path)) }

# Git on Windows checks files out with CRLF while GitHub stores LF, so line endings alone don't count as a change.
function SameFile([string]$a, [string]$b) {
  if (-not (Test-Path -LiteralPath $a -PathType Leaf) -or -not (Test-Path -LiteralPath $b -PathType Leaf)) { return $false }
  (Text $a).Replace("`r`n", "`n") -ceq (Text $b).Replace("`r`n", "`n")
}

function Version([string]$text) {
  $parts = @(($text -replace '^v', '') -split '\.' | ForEach-Object { [int]($_ -replace '\D.*$', '0') })
  while ($parts.Count -lt 4) { $parts += 0 }
  New-Object Version $parts[0], $parts[1], $parts[2], $parts[3]
}

function GitHubFailure($record) {
  $status = 0
  try { $status = [int]$record.Exception.Response.StatusCode } catch { }
  if ($status -eq 403 -or $status -eq 429) { return "GitHub is limiting requests from your connection right now. Try again in an hour. Nothing was changed." }
  if ($status -eq 404) { return "No GitHub release zip yet. Publish a release with a kivori-sekai zip, then try again. Nothing was changed." }
  if ($status -gt 0) { return "GitHub answered $status. Try again later. Nothing was changed." }
  "Couldn't reach GitHub. Check your connection and try again. Nothing was changed."
}

function PreferZip($assets) {
  $zips = @($assets | Where-Object { $_.name -match '\.zip$' -and $_.browser_download_url })
  $prefer = @($zips | Where-Object { $_.name -match 'kivori' })
  if ($prefer.Count) { return $prefer[0] }
  if ($zips.Count) { return $zips[0] }
  $null
}

# Newest published release with a zip asset. No master-branch fallback.
function LatestRelease {
  $headers = @{ "User-Agent" = "KivoriSekAI-update" }
  try {
    $release = Invoke-RestMethod -Uri "$ApiBase/repos/$Repo/releases/latest" -UseBasicParsing -Headers $headers
  } catch { throw (GitHubFailure $_) }
  if (-not $release.tag_name) { throw "No GitHub release zip yet. Publish a release with a kivori-sekai zip, then try again. Nothing was changed." }
  $asset = PreferZip $release.assets
  if (-not $asset) { throw "The latest GitHub release has no zip asset. Attach kivori-sekai-<version>.zip to the release, then try again. Nothing was changed." }
  [pscustomobject]@{ Tag = [string]$release.tag_name; Url = [string]$asset.browser_download_url }
}

function Blocked([string]$file) {
  "Your antivirus blocked $file, so nothing was changed. This is a false alarm on Kivori SekAI's own files. Allow the KivoriSekAI folder in your antivirus (Windows Security > Virus & threat protection > Exclusions) and run update.cmd again, or get the zip from https://github.com/$Repo/releases."
}

function WriteFailure([string]$file, $record) {
  $error0 = $record.Exception
  while ($error0.InnerException) { $error0 = $error0.InnerException }
  # 225 / 226: Windows refused the file because an antivirus flagged it.
  if (($error0.HResult -band 0xFFFF) -in 225, 226) { return Blocked $file }
  if (($error0.HResult -band 0xFFFF) -in 39, 112) { return "Your disk is full, so $file couldn't be written. Nothing was changed. Free up some space and run update.cmd again." }
  "Couldn't write $file ($($error0.Message.Trim())). Nothing was changed. Close anything using the Kivori SekAI folder and run update.cmd again."
}

$work = Join-Path ([IO.Path]::GetTempPath()) ("kivori-update-" + [Guid]::NewGuid().ToString("N").Substring(0, 8))
try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
  Add-Type -AssemblyName System.IO.Compression.FileSystem

  $Root = (Resolve-Path -LiteralPath $Root).ProviderPath
  $manifestPath = Join-Path $Root "manifest.json"
  if (-not (Test-Path -LiteralPath $manifestPath)) { throw "There's no Kivori SekAI in $Root. Put update.cmd back in your Kivori SekAI folder and run it from there." }
  $installed = ReadManifest $manifestPath
  if ($installed.name -ne $AppName) { throw "$Root isn't a Kivori SekAI folder. Run update.cmd from your Kivori SekAI folder." }
  if (Test-Path -LiteralPath (Join-Path $Root ".git")) { throw "This Kivori SekAI folder is a git checkout. Update it with git pull instead." }
  Write-Host "$AppName $($installed.version) in $Root"

  New-Item -ItemType Directory -Path $work | Out-Null
  $archive = Join-Path $work "kivori.zip"
  if ($Zip) {
    Copy-Item -LiteralPath $Zip -Destination $archive
  } else {
    Write-Host "Checking GitHub for the newest release..."
    $release = LatestRelease
    Write-Host "Downloading $($release.Tag)..."
    try {
      Invoke-WebRequest -Uri $release.Url -OutFile $archive -UseBasicParsing -Headers @{ "User-Agent" = "KivoriSekAI-update" }
    } catch { throw (GitHubFailure $_) }
  }

  # Read what the zip holds before unpacking, so a file the antivirus removes on the way out is noticed.
  try {
    $reader = [IO.Compression.ZipFile]::OpenRead($archive)
    try { $entries = @($reader.Entries | Where-Object { $_.Name } | ForEach-Object { [pscustomobject]@{ Path = $_.FullName.Replace("\", "/"); Size = $_.Length } }) }
    finally { $reader.Dispose() }
  } catch { throw "The download is damaged. Run update.cmd again. Nothing was changed." }
  $prefix = ""
  if (-not ($entries | Where-Object { $_.Path -eq "manifest.json" })) {
    $top = @($entries | ForEach-Object { ($_.Path -split "/")[0] } | Select-Object -Unique)
    if ($top.Count -ne 1) { throw "The download doesn't look like Kivori SekAI. Nothing was changed." }
    $prefix = "$($top[0])/"
  }

  $stage = Join-Path $work "files"
  [IO.Compression.ZipFile]::ExtractToDirectory($archive, $stage)
  Start-Sleep -Milliseconds $SettleMs
  # Reading each file back is what makes an antivirus decide on it, so a flagged file shows up here, before anything changes.
  foreach ($entry in $entries) {
    $size = -1
    try { $size = [IO.File]::ReadAllBytes((Local $stage $entry.Path)).Length } catch { }
    if ($size -ne $entry.Size) { throw (Blocked $entry.Path.Substring($prefix.Length)) }
  }
  $source = Local $stage $prefix

  $nextManifestPath = Join-Path $source "manifest.json"
  if (-not (Test-Path -LiteralPath $nextManifestPath)) { throw "The download doesn't look like Kivori SekAI. Nothing was changed." }
  $next = ReadManifest $nextManifestPath
  if ($next.name -ne $AppName) { throw "The download doesn't look like Kivori SekAI. Nothing was changed." }
  if (-not $Force -and (Version $next.version) -le (Version $installed.version)) {
    Write-Host "You already have the newest version ($($installed.version))."
    Finish 0
  }

  $content = ContentFiles $next
  $files = @($entries | ForEach-Object { $_.Path.Substring($prefix.Length) } | Where-Object { $_ -ne "manifest.json" -and (IsPackagePath $_ $content) } | Sort-Object)
  $changed = @($files | Where-Object { -not (SameFile (Local $source $_) (Local $Root $_)) })

  $present = @()
  foreach ($folder in $Folders) {
    $dir = Join-Path $Root $folder
    if (Test-Path -LiteralPath $dir -PathType Container) {
      $present += @(Get-ChildItem -LiteralPath $dir -Recurse -File -Force | ForEach-Object { $_.FullName.Substring($Root.TrimEnd("\").Length + 1).Replace("\", "/") })
    }
  }
  $present += @(@($RootFiles) + @(ContentFiles $installed) | Where-Object { Test-Path -LiteralPath (Local $Root $_) -PathType Leaf })
  $keep = @{}
  foreach ($file in $files) { $keep[$file.ToLowerInvariant()] = $true }
  $stale = @($present | Select-Object -Unique | Where-Object { -not $keep[$_.ToLowerInvariant()] -and $_ -ne "manifest.json" -and (IsPackagePath $_ $content) })

  # The localhost bridge only serves the lab mockup (sideloadManifest in lib/update-files.js).
  $manifestBytes = [IO.File]::ReadAllBytes($nextManifestPath)
  if ($next.PSObject.Properties.Name -contains "externally_connectable") {
    $next.PSObject.Properties.Remove("externally_connectable")
    $manifestBytes = $Utf8.GetBytes(($next | ConvertTo-Json -Depth 32) + "`n")
  }

  Write-Host "Installing $($next.version): $($changed.Count) changed, $($stale.Count) removed..."
  $backup = Join-Path $work "backup"
  $saved = @{}
  $created = New-Object Collections.ArrayList
  $removed = New-Object Collections.ArrayList
  $file = ""
  try {
    foreach ($file in @($changed) + @($stale) + @("manifest.json")) {
      $path = Local $Root $file
      if (Test-Path -LiteralPath $path -PathType Leaf) {
        $copy = Local $backup $file
        New-Item -ItemType Directory -Path (Split-Path -Parent $copy) -Force | Out-Null
        [IO.File]::Copy($path, $copy, $true)
        $saved[$file] = $copy
      }
    }
    foreach ($file in $changed) {
      $path = Local $Root $file
      New-Item -ItemType Directory -Path (Split-Path -Parent $path) -Force | Out-Null
      if (-not $saved.ContainsKey($file)) { [void]$created.Add($file) }
      [IO.File]::Copy((Local $source $file), $path, $true)
    }
    Start-Sleep -Milliseconds $SettleMs
    foreach ($file in $changed) {
      $path = Local $Root $file
      $same = $false
      try { $same = (Text $path) -ceq (Text (Local $source $file)) } catch { }
      if (-not $same) { throw (Blocked $file) }
    }
    foreach ($file in $stale) {
      Remove-Item -LiteralPath (Local $Root $file) -Force
      [void]$removed.Add($file)
    }
    $file = "manifest.json"
    [IO.File]::WriteAllBytes($manifestPath, $manifestBytes)
  } catch {
    $reason = if ($_.Exception -is [Management.Automation.RuntimeException] -and $_.Exception.WasThrownFromThrowStatement) { $_.Exception.Message } else { WriteFailure $file $_ }
    foreach ($file in @($changed) + @($removed) + @("manifest.json")) {
      try { if ($saved.ContainsKey($file)) { [IO.File]::Copy($saved[$file], (Local $Root $file), $true) } } catch { }
    }
    foreach ($file in $created) {
      try { Remove-Item -LiteralPath (Local $Root $file) -Force -ErrorAction SilentlyContinue } catch { }
    }
    throw $reason
  }

  Write-Host ""
  Write-Host "$AppName is updated to $($next.version)."
  Write-Host "Open Kivori SekAI and it restarts itself on the new version, or press Reload on Kivori SekAI in chrome://extensions."
  Finish 0
} catch {
  Write-Host ""
  Write-Host $_.Exception.Message -ForegroundColor Yellow
  Finish 1
} finally {
  Remove-Item -LiteralPath $work -Recurse -Force -ErrorAction SilentlyContinue
}

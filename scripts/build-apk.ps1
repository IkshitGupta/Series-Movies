<#
  Build a signed, standalone "Seen It" release APK for sideloading.

  Usage (from repo root):   npm run apk
  Output:                   .\SeenIt-v<versionCode>.apk

  Prerequisites (already true on this machine):
    - JDK 17 (JAVA_HOME set)
    - Android SDK at C:\Android\Sdk
    - The release keystore restored at android\app\seenit-release.keystore
      (backup lives in .\credentials\ — see credentials\README.md)

  To ship an UPDATE: bump versionCode in app.json (android.versionCode) AND
  android\app\build.gradle (versionCode + versionName), then run this. The user
  installs the new APK over the old one (tap -> Update) with no data loss, because
  it is signed with the same seenit-release.keystore.
#>
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
Set-Location $repo

# Restore the release keystore into android/app if it's missing (e.g. android/ was regenerated).
$ks = 'android\app\seenit-release.keystore'
if (-not (Test-Path $ks)) {
  if (Test-Path 'credentials\seenit-release.keystore') {
    Copy-Item 'credentials\seenit-release.keystore' $ks -Force
    Write-Host "Restored release keystore from credentials\." -ForegroundColor Yellow
  } else {
    throw "Release keystore missing and no backup in credentials\. Cannot sign the APK."
  }
}

# Point Gradle at the Android SDK.
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME = 'C:\Android\Sdk' }
$env:ANDROID_SDK_ROOT = $env:ANDROID_HOME

# Read versionCode so we can name the artifact.
$gradle = Get-Content 'android\app\build.gradle' -Raw
$versionCode = ([regex]::Match($gradle, 'versionCode\s+(\d+)')).Groups[1].Value
if (-not $versionCode) { $versionCode = 'x' }

Write-Host "Building Seen It release APK (versionCode $versionCode)..." -ForegroundColor Cyan
Push-Location android
try {
  & .\gradlew.bat assembleRelease
  if ($LASTEXITCODE -ne 0) { throw "Gradle build failed (exit $LASTEXITCODE)." }
} finally {
  Pop-Location
}

$built = 'android\app\build\outputs\apk\release\app-release.apk'
if (-not (Test-Path $built)) { throw "Build reported success but APK not found at $built." }

$out = "SeenIt-v$versionCode.apk"
Copy-Item $built $out -Force
$mb = [math]::Round((Get-Item $out).Length / 1MB, 1)
Write-Host ""
Write-Host "APK ready: $repo\$out ($mb MB)" -ForegroundColor Green
Write-Host "Send this file to the phone, tap it, choose Update (do NOT uninstall)."

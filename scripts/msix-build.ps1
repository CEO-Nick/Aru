# 초안. CI에서 아직 돌려 보지 않았다.
#
# 스토어 제출·사이드로드용 MSIX(.msix, 두 아키텍처면 .msixbundle)를 만든다. 맥의 scripts/mas-build.sh에 대응한다.
# 빌드는 하지 않는다 — 먼저 `npx tauri build --no-bundle [--target aarch64-pc-windows-msvc]`로 exe를 만들어 둔다.
#
# 입력(파라미터가 우선, 없으면 환경 변수):
#   -Arch                  x64, arm64 (여러 개면 .msixbundle도 만든다)
#   -Publisher             MSIX_PUBLISHER              "CN=…" — Partner Center 「제품 ID」의 Package/Identity/Publisher 값 그대로
#   -PublisherDisplayName  MSIX_PUBLISHER_DISPLAY_NAME Partner Center의 게시자 표시 이름
#   -IdentityName          MSIX_IDENTITY_NAME          Partner Center의 Package/Identity/Name (예: 12345Name.Aru)
#   -Version               MSIX_VERSION                생략하면 tauri.conf.json의 version + ".0" (스토어는 네 번째 자리가 0이어야 한다)
#   -PfxPath               MSIX_PFX                    서명 인증서(.pfx). 없으면 서명을 건너뛴다(스토어 제출본은 스토어가 서명한다)
#   -PfxPassword           MSIX_PFX_PASSWORD
#   -GuiExe / -CliExe      MSIX_GUI_EXE / MSIX_CLI_EXE 기본 aru.exe / aru-cli.exe
#                          Tauri 2는 exe를 productName이 아니라 Cargo 패키지명으로 낸다(mainBinaryName 미설정 시). 확인 필요 항목.
# 사용(pwsh 7 권장 — 이 파일은 UTF-8 BOM으로 저장해 Windows PowerShell 5.1에서도 한글이 깨지지 않게 했다):
#   pwsh scripts/msix-build.ps1 -Arch x64,arm64 -Publisher "CN=…" -PublisherDisplayName "…" -IdentityName "…"
[CmdletBinding()]
param(
  [ValidateSet("x64", "arm64")] [string[]] $Arch = @("x64"),
  [string] $Publisher = $env:MSIX_PUBLISHER,
  [string] $PublisherDisplayName = $env:MSIX_PUBLISHER_DISPLAY_NAME,
  [string] $IdentityName = $env:MSIX_IDENTITY_NAME,
  [string] $Version = $env:MSIX_VERSION,
  [string] $PfxPath = $env:MSIX_PFX,
  [string] $PfxPassword = $env:MSIX_PFX_PASSWORD,
  [string] $GuiExe = $(if ($env:MSIX_GUI_EXE) { $env:MSIX_GUI_EXE } else { "aru.exe" }),
  [string] $CliExe = $(if ($env:MSIX_CLI_EXE) { $env:MSIX_CLI_EXE } else { "aru-cli.exe" })
)
$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

foreach ($name in "Publisher", "PublisherDisplayName", "IdentityName") {
  if (-not (Get-Variable $name -ValueOnly)) { throw "$name 값이 필요합니다(파라미터 또는 환경 변수)" }
}

$root = Split-Path -Parent $PSScriptRoot
$tauriDir = Join-Path $root "src-tauri"
$target = Join-Path $tauriDir "target"
$outDir = Join-Path $target "msix"
New-Item -ItemType Directory -Force $outDir | Out-Null

if (-not $Version) {
  $conf = Get-Content (Join-Path $tauriDir "tauri.conf.json") -Raw | ConvertFrom-Json
  $Version = "$($conf.version).0"
}
if ($Version -notmatch '^\d+\.\d+\.\d+\.0$') { throw "MSIX 버전은 a.b.c.0 꼴이어야 합니다: $Version" }

function Find-SdkTool([string] $exe) {
  # 러너·PC마다 SDK 버전 폴더가 달라 가장 높은 버전을 고른다
  $hit = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\$exe" -ErrorAction SilentlyContinue |
    Sort-Object { [version]($_.Directory.Parent.Name) } -Descending | Select-Object -First 1
  if (-not $hit) { throw "$exe 을(를) Windows SDK에서 찾지 못했습니다" }
  $hit.FullName
}
$makeappx = Find-SdkTool "makeappx.exe"
$signtool = if ($PfxPath) { Find-SdkTool "signtool.exe" } else { $null }

function Invoke-Tool([string] $exe, [string[]] $toolArgs) {
  & $exe @toolArgs
  if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $exe) 실패(종료 코드 $LASTEXITCODE)" }
}

function Sign-Package([string] $path) {
  if (-not $PfxPath) { Write-Host "서명 인증서가 없어 서명을 건너뜁니다: $path"; return }
  $signArgs = @("sign", "/fd", "SHA256", "/a", "/f", $PfxPath)
  if ($PfxPassword) { $signArgs += @("/p", $PfxPassword) }
  Invoke-Tool $signtool ($signArgs + $path)
}

# tauri build는 --target이 없으면 target/release, 있으면 target/<triple>/release에 낸다
$triples = @{ x64 = "x86_64-pc-windows-msvc"; arm64 = "aarch64-pc-windows-msvc" }
function Find-ReleaseDir([string] $a) {
  $candidates = @((Join-Path $target "$($triples[$a])\release"))
  if ($a -eq "x64") { $candidates += (Join-Path $target "release") }
  foreach ($dir in $candidates) {
    if (Test-Path (Join-Path $dir $GuiExe)) { return $dir }
  }
  throw "$a 용 $GuiExe 을(를) 찾지 못했습니다. 찾은 곳: $($candidates -join ', ')"
}

function Escape-Xml([string] $s) { [System.Security.SecurityElement]::Escape($s) }

$template = Get-Content (Join-Path $tauriDir "msix\AppxManifest.xml") -Raw -Encoding UTF8
# 스토어 로고: tauri icon이 만든 정해진 크기 PNG를 그대로 쓴다(44·71·150·310, StoreLogo 50)
$logos = "Square44x44Logo.png", "Square71x71Logo.png", "Square150x150Logo.png", "Square310x310Logo.png", "StoreLogo.png"

$packages = @()
foreach ($a in $Arch) {
  $release = Find-ReleaseDir $a
  foreach ($exe in $GuiExe, $CliExe) {
    if (-not (Test-Path (Join-Path $release $exe))) { throw "$release 에 $exe 이(가) 없습니다" }
  }

  $staging = Join-Path $outDir "staging-$a"
  if (Test-Path $staging) { Remove-Item -Recurse -Force $staging }
  New-Item -ItemType Directory -Force (Join-Path $staging "Assets") | Out-Null

  Copy-Item (Join-Path $release $GuiExe), (Join-Path $release $CliExe) $staging
  # MSVC 빌드는 WebView2 로더를 정적 링크한다고 알려져 있다(GNU 타깃만 WebView2Loader.dll을 복사).
  # exe 옆에 DLL이 생겼으면 실행에 필요할 수 있으니 함께 넣고 알린다
  Get-ChildItem $release -Filter *.dll -File -ErrorAction SilentlyContinue | ForEach-Object {
    Write-Warning "exe 옆 DLL을 패키지에 넣습니다: $($_.Name)"
    Copy-Item $_.FullName $staging
  }
  foreach ($logo in $logos) {
    $src = Join-Path $tauriDir "icons\$logo"
    if (-not (Test-Path $src)) { throw "로고가 없습니다: $src (npx tauri icon 으로 만든다)" }
    Copy-Item $src (Join-Path $staging "Assets")
  }

  $values = [ordered]@{
    "{{IDENTITY_NAME}}" = (Escape-Xml $IdentityName)
    "{{PUBLISHER}}" = (Escape-Xml $Publisher)
    "{{PUBLISHER_DISPLAY_NAME}}" = (Escape-Xml $PublisherDisplayName)
    "{{VERSION}}" = $Version
    "{{ARCH}}" = $a
    "{{GUI_EXE}}" = $GuiExe
    "{{CLI_EXE}}" = $CliExe
  }
  $manifest = $template
  foreach ($key in $values.Keys) { $manifest = $manifest.Replace($key, $values[$key]) }
  if ($manifest -match '\{\{[A-Z_]+\}\}') { throw "치환되지 않은 자리가 남았습니다: $($Matches[0])" }
  [System.IO.File]::WriteAllText((Join-Path $staging "AppxManifest.xml"), $manifest, (New-Object System.Text.UTF8Encoding $false))

  $msix = Join-Path $outDir "Aru_${Version}_$a.msix"
  Invoke-Tool $makeappx @("pack", "/o", "/d", $staging, "/p", $msix)
  Sign-Package $msix
  $packages += $msix
}

if ($packages.Count -gt 1) {
  $bundleDir = Join-Path $outDir "bundle-input"
  if (Test-Path $bundleDir) { Remove-Item -Recurse -Force $bundleDir }
  New-Item -ItemType Directory -Force $bundleDir | Out-Null
  Copy-Item $packages $bundleDir
  $bundle = Join-Path $outDir "Aru_$Version.msixbundle"
  Invoke-Tool $makeappx @("bundle", "/o", "/bv", $Version, "/d", $bundleDir, "/p", $bundle)
  Sign-Package $bundle
  Write-Host "만들었습니다: $bundle"
} else {
  Write-Host "만들었습니다: $($packages[0])"
}

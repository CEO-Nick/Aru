#!/usr/bin/env bash
# 앱스토어 제출용 .pkg를 만든다. 만든 파일은 Transporter 앱으로 App Store Connect에 올린다.
#
# 필요한 것(Apple Developer 계정에서 받는다):
#   MAS_APP_IDENTITY       "3rd Party Mac Developer Application: 이름 (팀ID)" 또는 "Apple Distribution: 이름 (팀ID)"
#   MAS_INSTALLER_IDENTITY "3rd Party Mac Developer Installer: 이름 (팀ID)"
#   MAS_PROFILE            Mac App Store용 프로비저닝 프로파일(.provisionprofile) 경로
#   MAS_TEAM_ID            팀 ID(10자리, 인증서 이름 괄호 안의 값)
# 고를 수 있는 것:
#   MAS_BUILD_NUMBER       빌드 번호(CFBundleVersion). 없으면 지금 시각(yyMMddHHmm) — 같은 버전을 다시 올릴 때도 늘어나야 한다
#   MAS_DRY_RUN=1          계정 없이 리허설: 서명하지 않고 같은 과정으로 .app·.pkg를 만든다(업로드는 못 한다)
# 사용: MAS_APP_IDENTITY=... MAS_INSTALLER_IDENTITY=... MAS_PROFILE=... MAS_TEAM_ID=... scripts/mas-build.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DRY=${MAS_DRY_RUN:-}
if [[ -z "$DRY" ]]; then
  : "${MAS_APP_IDENTITY:?앱 서명 인증서 이름이 필요합니다}"
  : "${MAS_INSTALLER_IDENTITY:?설치 패키지 서명 인증서 이름이 필요합니다}"
  : "${MAS_PROFILE:?프로비저닝 프로파일 경로가 필요합니다}"
  : "${MAS_TEAM_ID:?팀 ID가 필요합니다}"
fi
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
BUILD=${MAS_BUILD_NUMBER:-$(date +%y%m%d%H%M)}

# Xcode 없이 서명하면 팀 ID 권한 두 개를 직접 넣어야 한다. 없으면 업로드가 거절된다(프로파일의 앱 ID와 맞아야 한다)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
ENT="$WORK/Aru.entitlements"
cp src-tauri/Aru.entitlements "$ENT"
if [[ -z "$DRY" ]]; then
  BUNDLE_ID=$(node -p "require('./src-tauri/tauri.conf.json').identifier")
  /usr/libexec/PlistBuddy -c "Add :com.apple.application-identifier string $MAS_TEAM_ID.$BUNDLE_ID" "$ENT"
  /usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string $MAS_TEAM_ID" "$ENT"
fi

# 프로파일은 서명 전에 묶음 안에 들어가 있어야 한다
OVERRIDE=$(ENT="$ENT" BUILD="$BUILD" DRY="$DRY" node -e '
  const mac = { bundleVersion: process.env.BUILD, entitlements: process.env.ENT };
  if (!process.env.DRY) {
    mac.signingIdentity = process.env.MAS_APP_IDENTITY;
    mac.files = { "embedded.provisionprofile": process.env.MAS_PROFILE };
  }
  console.log(JSON.stringify({ bundle: { macOS: mac } }));
')
npx tauri build --bundles app --target universal-apple-darwin --config "$OVERRIDE"

TARGET=${CARGO_TARGET_DIR:-src-tauri/target}
APP=$TARGET/universal-apple-darwin/release/bundle/macos/Aru.app
OUT=$TARGET/mas/Aru-$VERSION-$BUILD.pkg
mkdir -p "$(dirname "$OUT")"
if [[ -z "$DRY" ]]; then
  productbuild --component "$APP" /Applications --sign "$MAS_INSTALLER_IDENTITY" "$OUT"
else
  productbuild --component "$APP" /Applications "$OUT"
fi
echo "만들었습니다: $OUT (버전 $VERSION, 빌드 $BUILD${DRY:+, 서명 없는 리허설})"

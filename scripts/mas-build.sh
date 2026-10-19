#!/usr/bin/env bash
# 앱스토어 제출용 .pkg를 만든다. 만든 파일은 Transporter 앱으로 App Store Connect에 올린다.
#
# 필요한 것(Apple Developer 계정에서 받는다):
#   MAS_APP_IDENTITY       "3rd Party Mac Developer Application: 이름 (팀ID)" 또는 "Apple Distribution: 이름 (팀ID)"
#   MAS_INSTALLER_IDENTITY "3rd Party Mac Developer Installer: 이름 (팀ID)"
#   MAS_PROFILE            Mac App Store용 프로비저닝 프로파일(.provisionprofile) 경로
# 사용: MAS_APP_IDENTITY=... MAS_INSTALLER_IDENTITY=... MAS_PROFILE=... scripts/mas-build.sh
set -euo pipefail
: "${MAS_APP_IDENTITY:?앱 서명 인증서 이름이 필요합니다}"
: "${MAS_INSTALLER_IDENTITY:?설치 패키지 서명 인증서 이름이 필요합니다}"
: "${MAS_PROFILE:?프로비저닝 프로파일 경로가 필요합니다}"

cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./src-tauri/tauri.conf.json').version")
# 프로파일은 서명 전에 묶음 안에 들어가 있어야 한다
OVERRIDE=$(printf '{"bundle":{"macOS":{"signingIdentity":"%s","files":{"embedded.provisionprofile":"%s"}}}}' "$MAS_APP_IDENTITY" "$MAS_PROFILE")
npx tauri build --bundles app --target universal-apple-darwin --config "$OVERRIDE"

APP=src-tauri/target/universal-apple-darwin/release/bundle/macos/Aru.app
OUT=src-tauri/target/mas/Aru-$VERSION.pkg
mkdir -p "$(dirname "$OUT")"
productbuild --component "$APP" /Applications --sign "$MAS_INSTALLER_IDENTITY" "$OUT"
echo "만들었습니다: $OUT"

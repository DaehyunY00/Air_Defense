#!/usr/bin/env bash
# K-JAMDS 시뮬레이터 — 로컬 정적 서버 실행 편의 스크립트
#
# python3 -m http.server를 --bind 없이 실행하면(특히 macOS) 터미널에 IPv6 와일드카드
# 주소(http://[::]:PORT/)가 출력되어, 그 링크를 그대로 클릭해도 브라우저에서 열리지
# 않는 경우가 있다. 이 스크립트는 127.0.0.1에 명시적으로 바인딩해 터미널에 뜨는 링크가
# 항상 바로 열리도록 한다 — 매번 --bind 옵션을 직접 입력할 필요가 없다.
#
# 실행: ./scripts/serve.sh [포트, 기본 8000]  (저장소 루트에서, 또는 아무 위치에서나)
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

PORT="${1:-8000}"
echo "K-JAMDS 시뮬레이터 로컬 서버 시작 → http://localhost:${PORT}"
exec python3 -m http.server "${PORT}" --bind 127.0.0.1

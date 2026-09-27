#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p .runtime/tmp .cache
export TMPDIR="$PWD/.runtime/tmp"
export XDG_CACHE_HOME="$PWD/.cache"
export XDG_CONFIG_HOME="$PWD/.runtime/config"
export ELECTRON_CACHE="$PWD/.cache/electron"
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.cache/playwright"
if [[ -d "$PWD/.runtime/node-v22.23.3-linux-x64/bin" ]]; then
    export PATH="$PWD/.runtime/node-v22.23.3-linux-x64/bin:$PATH"
fi
case "${1:-server}" in
    server) exec node server.cjs ;;
    desktop) exec node desktop/launch.cjs ;;
    test) exec npm test ;;
    *) echo '用法: bash run.sh [server|desktop|test]'; exit 1 ;;
esac

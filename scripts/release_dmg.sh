#!/usr/bin/env bash
set -euo pipefail

# 从任意工作目录使用已安装的 npm Tauri CLI 构建并发布本次 DMG。
# 用法：scripts/release_dmg.sh [TAG]；默认 TAG 为 v<配置版本>。
# 凭据只使用现有 gh 登录或 GITHUB_TOKEN，不创建或轮换令牌。
ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
exec node "$ROOT_DIR/scripts/release_dmg.mjs" "$@"

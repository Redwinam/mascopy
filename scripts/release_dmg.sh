#!/usr/bin/env bash
set -euo pipefail

# 自动构建并发布 DMG 到 GitHub Release
# 用法：
#   scripts/release_dmg.sh [TAG]
#  - 若未提供 TAG，脚本将从 src-tauri/tauri.conf.json 读取 version 并使用 v<version>
# 依赖：
#  - 可选：gh (GitHub CLI)，若存在将优先使用
#  - 备用：GITHUB_TOKEN 环境变量（访问 GitHub API）

ROOT_DIR=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT_DIR"

TAG_ARG=${1:-}

if [[ -z "$TAG_ARG" ]]; then
  if command -v jq >/dev/null 2>&1; then
    VERSION=$(jq -r .version src-tauri/tauri.conf.json)
  else
    VERSION=$(sed -n 's/.*"version"\s*:\s*"\([^"]*\)".*/\1/p' src-tauri/tauri.conf.json)
  fi
  if [[ -z "$VERSION" ]]; then
    echo "无法解析版本号，请提供 TAG，例如 v2.2.4"
    exit 1
  fi
  TAG="v$VERSION"
else
  TAG="$TAG_ARG"
fi

echo "使用 TAG: $TAG"

echo "构建前端..."
pushd src-ui >/dev/null
npm run build
popd >/dev/null

echo "构建 DMG..."
cargo tauri build --bundles dmg

DMG_PATH=$(
  ls -t target/release/bundle/dmg/*.dmg 2>/dev/null | grep -v '/rw\.' | head -n 1 || true
)
if [[ -z "$DMG_PATH" ]]; then
  DMG_PATH=$(ls -t src-tauri/target/release/bundle/dmg/*.dmg 2>/dev/null | grep -v '/rw\.' | head -n 1 || true)
fi
if [[ -z "$DMG_PATH" ]]; then
  echo "未找到 DMG 文件，路径应位于 target/release/bundle/dmg/*.dmg"
  exit 1
fi
echo "找到 DMG: $DMG_PATH"

# 解析 GitHub 仓库
ORIGIN_URL=$(git remote get-url origin)
REPO=""
case "$ORIGIN_URL" in
  https://github.com/*)
    REPO="${ORIGIN_URL#https://github.com/}"
    REPO="${REPO%.git}"
    ;;
  git@github.com:*)
    REPO="${ORIGIN_URL#git@github.com:}"
    REPO="${REPO%.git}"
    ;;
esac
if [[ -z "$REPO" ]]; then
  echo "无法解析 GitHub 远程仓库，请确保已设置 origin"
  exit 1
fi
echo "仓库: $REPO"

TITLE="mascopy $TAG"
NOTES="Auto-generated DMG release"

if command -v gh >/dev/null 2>&1; then
  echo "使用 gh 创建/上传 release..."
  if gh release view "$TAG" >/dev/null 2>&1; then
    gh release upload "$TAG" "$DMG_PATH" --clobber
  else
    gh release create "$TAG" "$DMG_PATH" --title "$TITLE" --notes "$NOTES"
  fi
else
  echo "gh 不可用，使用 GitHub API；需要 GITHUB_TOKEN"
  if [[ -z "${GITHUB_TOKEN:-}" ]]; then
    echo "缺少 GITHUB_TOKEN 环境变量"
    exit 1
  fi
  API="https://api.github.com"
  CREATE_JSON=$(printf '{"tag_name":"%s","name":"%s","draft":false}' "$TAG" "$TITLE")
  CREATE_RESP=$(curl -sS -H "Authorization: token $GITHUB_TOKEN" -H "Content-Type: application/json" \
    -d "$CREATE_JSON" "$API/repos/$REPO/releases")
  UPLOAD_URL=$(echo "$CREATE_RESP" | sed -n 's/.*"upload_url"\s*:\s*"\([^"]*\)".*/\1/p' | sed 's/{.*}//')
  if [[ -z "$UPLOAD_URL" ]]; then
    # 可能已存在该 TAG 的 release，改为获取
    REL_RESP=$(curl -sS -H "Authorization: token $GITHUB_TOKEN" "$API/repos/$REPO/releases/tags/$TAG")
    UPLOAD_URL=$(echo "$REL_RESP" | sed -n 's/.*"upload_url"\s*:\s*"\([^"]*\)".*/\1/p' | sed 's/{.*}//')
  fi
  if [[ -z "$UPLOAD_URL" ]]; then
    echo "无法获取 upload_url"
    exit 1
  fi
  echo "上传 DMG 到 release..."
  curl -sS -H "Authorization: token $GITHUB_TOKEN" -H "Content-Type: application/octet-stream" \
    --data-binary @"$DMG_PATH" "$UPLOAD_URL?name=$(basename "$DMG_PATH")"
fi

echo "✅ 发布完成: $TAG -> $(basename "$DMG_PATH")"

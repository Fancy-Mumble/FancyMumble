#!/usr/bin/env bash
# Build the Tauri updater manifest (`latest.json`) for one release.
#
# The updater consumes exactly two bundles: the Windows NSIS installer and the
# Linux AppImage, each next to the detached signature Tauri produced for it. A
# platform whose signature is missing is left out of the manifest rather than
# published with a broken entry - that way a partial build degrades to "no
# update for that platform" instead of a failing download for every client.
#
# Usage: make-update-manifest.sh <version> <download-base-url> <artifacts-dir> [notes]
set -euo pipefail

VERSION="${1:?version required}"
BASE="${2:?download base URL required}"
ARTIFACTS="${3:?artifacts directory required}"
NOTES="${4:-See release notes on GitHub.}"

PUB_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

find_one() { find "$ARTIFACTS" -type f -name "$1" | head -n1; }
read_sig() { [ -n "${1:-}" ] && [ -f "$1" ] && cat "$1" || echo ""; }

WIN_NSIS=$(find_one "*-setup.exe" || true)
WIN_NSIS_SIG=$(find_one "*-setup.exe.sig" || true)
LINUX_APPIMAGE=$(find_one "*.AppImage" || true)
LINUX_APPIMAGE_SIG=$(find_one "*.AppImage.sig" || true)

jq -n \
  --arg version "$VERSION" \
  --arg notes "$NOTES" \
  --arg pub_date "$PUB_DATE" \
  --arg win_url "$BASE/$(basename "${WIN_NSIS:-missing}")" \
  --arg win_sig "$(read_sig "${WIN_NSIS_SIG:-}")" \
  --arg lin_url "$BASE/$(basename "${LINUX_APPIMAGE:-missing}")" \
  --arg lin_sig "$(read_sig "${LINUX_APPIMAGE_SIG:-}")" \
  '{
    version: $version,
    notes: $notes,
    pub_date: $pub_date,
    platforms: (
      (if $win_sig != "" then {"windows-x86_64": {signature: $win_sig, url: $win_url}} else {} end)
      + (if $lin_sig != "" then {"linux-x86_64": {signature: $lin_sig, url: $lin_url}} else {} end)
    )
  }'

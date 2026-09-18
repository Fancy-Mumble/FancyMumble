#!/usr/bin/env bash
# Print the section CHANGELOG.md holds for one version, without its heading.
#
#   scripts/changelog-section.sh 0.4.0 [CHANGELOG.md]
#   scripts/changelog-section.sh v0.4.0-beta.202
#
# The release job feeds the output to the GitHub release as its notes. A beta
# (`0.4.0-beta.3`) reads the section of the version it is a beta of. A version
# with no section prints nothing and still exits 0: a release with only
# GitHub's generated notes is better than no release.
set -euo pipefail

version="${1:?usage: changelog-section.sh <version> [changelog]}"
changelog="${2:-CHANGELOG.md}"
version="${version#v}"
version="${version%%-*}"

awk -v version="$version" '
  # A link reference at the foot of the file ends the last section.
  /^\[[^]]+\]: / { printing = 0 }
  /^## \[/ {
    printing = (index($0, "## [" version "]") == 1)
    next
  }
  printing { print }
' "$changelog" | sed -e 's/\r$//' -e '/./,$!d'

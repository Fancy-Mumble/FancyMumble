#!/usr/bin/env bash
# Regenerate the offline source manifests the Flatpak build needs.
#
# A Flathub builder has no network inside the build. Every crate and every npm
# package therefore has to be listed, with a hash, as a flatpak-builder source.
# These generators turn the three lockfiles in this repository into exactly
# that:
#
#   Cargo.lock                          -> cargo-sources.json
#   crates/signal-bridge/Cargo.lock     -> signal-bridge-cargo-sources.json
#   crates/mumble-tauri/ui/package-lock.json -> node-sources.json
#
# Run this whenever a lockfile changes AND whenever the tag in the manifests
# moves. The generated files describe one exact commit; a manifest pointing at
# v0.3.1 with v0.3.0's cargo-sources.json fails the offline build with a
# lockfile mismatch, usually a long way into it.
#
#   ./packaging/flatpak/generate-sources.sh
#
# Needs network (it resolves and hashes every dependency) and takes a few
# minutes. Commit the results.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "${here}/../.." && pwd)"

# Pinned so a regenerated file differs because a lockfile changed, not because
# upstream tooling drifted between two runs. Bump deliberately.
TOOLS_REF="${FLATPAK_BUILDER_TOOLS_REF:-master}"
TOOLS_URL="https://raw.githubusercontent.com/flatpak/flatpak-builder-tools/${TOOLS_REF}"

workdir="$(mktemp -d)"
trap 'rm -rf "${workdir}"' EXIT

echo ">> setting up generators (python venv in ${workdir})"
python3 -m venv "${workdir}/venv"
"${workdir}/venv/bin/pip" --quiet install \
    aiohttp toml tomlkit \
    "flatpak-node-generator @ git+https://github.com/flatpak/flatpak-builder-tools.git@${TOOLS_REF}#subdirectory=node"

curl -sSfL -o "${workdir}/flatpak-cargo-generator.py" \
    "${TOOLS_URL}/cargo/flatpak-cargo-generator.py"

cd "${repo}"

echo ">> cargo: the client workspace"
"${workdir}/venv/bin/python" "${workdir}/flatpak-cargo-generator.py" \
    Cargo.lock -o packaging/flatpak/cargo-sources.json

# Fetch DeepFilterNet as a tarball instead of a git clone.
#
# `deep_filter` is a git dependency of crates/fancy-denoiser-deepfilter, so the
# generator emits a `type: git` source for it and flatpak-builder clones it.
# That clone fails: the upstream repository uses git-lfs and at least one LFS
# object is missing from the server, which aborts the build during source
# download, before a single crate is compiled:
#
#   [4afcd87f...] Object does not exist on the server: [404]
#   error: failed to fetch some objects from
#          'https://github.com/rikorose/deepfilternet.git/info/lfs'
#
# The package cannot simply be dropped: fancy-denoiser-deepfilter is a workspace
# member and depends on it unconditionally, so cargo resolves it even though the
# non-default `deepfilternet-denoiser` feature leaves it uncompiled ("no
# matching package named `deep_filter` found"). It has to be present - it just
# never has to build.
#
# A GitHub source tarball of the same commit gives cargo everything it needs to
# resolve, and involves no LFS at all. The generator's own `cp` step (libDF ->
# cargo/vendor/deep_filter) is untouched, because the archive unpacks to exactly
# the path the clone would have produced.
#
# If the Flatpak ever ships `deepfilternet-denoiser`, this stops being enough:
# the model files are the LFS objects, so that needs fixing upstream first.
echo ">> cargo: swapping the DeepFilterNet git clone for a tarball (broken LFS)"
"${workdir}/venv/bin/python" - <<'PY'
import hashlib
import json
import urllib.request

path = "packaging/flatpak/cargo-sources.json"
with open(path) as fh:
    sources = json.load(fh)

for source in sources:
    if source.get("type") != "git" or "deepfilternet" not in source.get("url", "").lower():
        continue

    commit = source["commit"]
    url = f"https://github.com/Rikorose/DeepFilterNet/archive/{commit}.tar.gz"
    print(f"   hashing {url}")
    with urllib.request.urlopen(url) as response:
        payload = response.read()

    source.clear()
    source.update(
        {
            "type": "archive",
            "url": url,
            "sha256": hashlib.sha256(payload).hexdigest(),
            # strip-components defaults to 1, which removes the
            # DeepFilterNet-<commit>/ wrapper and leaves libDF/ where the
            # generator's cp step expects it.
            "dest": f"flatpak-cargo/git/deepfilternet-{commit[:7]}",
        }
    )
    print(f"   -> archive {source['sha256'][:16]}...")
    break
else:
    print("   no DeepFilterNet git source found - upstream may have fixed its LFS")

with open(path, "w") as fh:
    json.dump(sources, fh, indent=4)
PY

# signal-bridge is excluded from the workspace and keeps its own lockfile, so
# the root cargo-sources.json does not cover it. It is also the only one of the
# three that pulls git dependencies (libsignal, SparsePostQuantumRatchet); the
# generator vendors those as git sources pinned to the resolved commit.
echo ">> cargo: signal-bridge (separate workspace, AGPL)"
"${workdir}/venv/bin/python" "${workdir}/flatpak-cargo-generator.py" \
    crates/signal-bridge/Cargo.lock -o packaging/flatpak/signal-bridge-cargo-sources.json

echo ">> npm: the React frontend"
"${workdir}/venv/bin/flatpak-node-generator" npm \
    crates/mumble-tauri/ui/package-lock.json -o packaging/flatpak/node-sources.json

echo
echo "done. Regenerated:"
cd "${repo}/packaging/flatpak"
ls -lh cargo-sources.json signal-bridge-cargo-sources.json node-sources.json

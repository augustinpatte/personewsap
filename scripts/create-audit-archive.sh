#!/usr/bin/env bash
#
# create-audit-archive.sh — package this repository for an external audit
# without shipping anything secret.
#
# What it does:
#   1. copies the working tree into a staging directory, excluding build output,
#      dependency trees, caches and every known secret/signing pattern;
#   2. writes a __AUDIT__/ directory with the git facts an auditor asks for
#      first (status, branches, remotes, HEAD, log, tracked files, file list);
#   3. zips the result;
#   4. re-opens the finished zip and refuses to leave a file behind if a
#      sensitive name made it in anyway.
#
# .env.example files are kept on purpose: they document which variables exist
# without carrying any value.
#
# Usage:
#   scripts/create-audit-archive.sh [output-directory]
#
# Default output directory is the parent of the repository.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$(dirname "$REPO_ROOT")}"
STAMP="$(date +%Y%m%d-%H%M%S)"
NAME="personewsap-audit-$STAMP"
ZIP_PATH="$OUT_DIR/$NAME.zip"

STAGE="$(mktemp -d "${TMPDIR:-/tmp}/personewsap-audit.XXXXXX")"
cleanup() { rm -rf "$STAGE"; }
trap cleanup EXIT

echo "==> Repository : $REPO_ROOT"
echo "==> Archive    : $ZIP_PATH"

# ---------------------------------------------------------------------------
# 1. Copy the tree, excluding heavy directories and every secret pattern.
# ---------------------------------------------------------------------------

# Directory NAMES that must never appear in the archive, at any depth. Matching
# by name rather than by path matters: apps/mobile/node_modules and
# services/content-engine/node_modules are nested, and a root-anchored path
# would have let them through.
EXCLUDE_DIR_NAMES=(
  ".git"
  "node_modules"
  "dist"
  "dist-ssr"
  "build"
  ".expo"
  ".expo-shared"
  ".next"
  ".turbo"
  ".cache"
  "coverage"
  "Pods"
  "DerivedData"
  ".gradle"
  ".idea"
  ".vscode"
  ".temp"
  ".branches"
  "runs"
  "send_logs"
  "__AUDIT__"
)

# Filename patterns that must never appear in the archive. Kept in one place so
# the copy filter and the final verification below cannot drift apart.
SECRET_GLOBS=(
  ".env"
  ".env.*"
  "*.pem"
  "*.key"
  "*.p8"
  "*.p12"
  "*.pfx"
  "*.jks"
  "*.keystore"
  "*.mobileprovision"
  "*.cer"
  "*.certSigningRequest"
  "credentials.json"
  "*service-account*.json"
  "*serviceaccount*.json"
  "google-services.json"
  "GoogleService-Info.plist"
  "secrets.json"
  "*.secret"
  "*secrets.y*ml"
  "id_rsa*"
  "id_ed25519*"
  ".npmrc"
  ".netrc"
)

# The one deliberate exception: .env.example, at any depth.
is_kept_example() {
  [[ "$(basename "$1")" == ".env.example" ]]
}

DEST="$STAGE/$NAME"
mkdir -p "$DEST"

# Build a find(1) prune expression matching those directory names at any depth.
prune_expr=()
for d in "${EXCLUDE_DIR_NAMES[@]}"; do
  prune_expr+=( -name "$d" -o )
done

copied=0
skipped_secret=0

while IFS= read -r -d '' src; do
  rel="${src#"$REPO_ROOT"/}"
  base="$(basename "$src")"

  # Secret filter, with .env.example explicitly allowed back in.
  if ! is_kept_example "$src"; then
    matched=""
    for g in "${SECRET_GLOBS[@]}"; do
      # shellcheck disable=SC2053  # glob match is intentional
      if [[ "$base" == $g ]]; then matched="$g"; break; fi
    done
    if [[ -n "$matched" ]]; then
      echo "    skip (secret pattern $matched): $rel"
      skipped_secret=$((skipped_secret + 1))
      continue
    fi
  fi

  mkdir -p "$DEST/$(dirname "$rel")"
  cp -p "$src" "$DEST/$rel"
  copied=$((copied + 1))
done < <(find "$REPO_ROOT" \( -type d \( "${prune_expr[@]}" -false \) \) -prune -o -type f -print0)

echo "==> Copied $copied files, skipped $skipped_secret by secret pattern."

# ---------------------------------------------------------------------------
# 2. Git facts.
# ---------------------------------------------------------------------------

AUDIT="$DEST/__AUDIT__"
mkdir -p "$AUDIT"

git -C "$REPO_ROOT" status                             > "$AUDIT/git-status.txt"        2>&1 || true
git -C "$REPO_ROOT" branch -a -vv                      > "$AUDIT/git-branch.txt"        2>&1 || true
git -C "$REPO_ROOT" remote -v                          > "$AUDIT/git-remotes.txt"       2>&1 || true
git -C "$REPO_ROOT" log -1 --format='%H%n%an%n%ad%n%s' > "$AUDIT/git-head.txt"          2>&1 || true
git -C "$REPO_ROOT" log --oneline --decorate --graph --all --max-count=300 \
                                                       > "$AUDIT/git-log.txt"           2>&1 || true
git -C "$REPO_ROOT" ls-files                           > "$AUDIT/git-tracked-files.txt" 2>&1 || true

( cd "$DEST" && find . -type f | LC_ALL=C sort )       > "$AUDIT/local-file-list.txt"

{
  echo "PersoNewsAP audit archive"
  echo "Generated: $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
  echo "Source:    $REPO_ROOT"
  echo
  echo "Excluded: .git, node_modules, build output, caches, Pods, and every"
  echo "secret/signing pattern listed in scripts/create-audit-archive.sh."
  echo ".env.example files are included on purpose (variable names, no values)."
} > "$AUDIT/README.txt"

echo "==> Wrote __AUDIT__/ ($(ls -1 "$AUDIT" | wc -l | tr -d ' ') files)."

# ---------------------------------------------------------------------------
# 3. Zip.
# ---------------------------------------------------------------------------

mkdir -p "$OUT_DIR"
rm -f "$ZIP_PATH"
( cd "$STAGE" && zip -q -r "$ZIP_PATH" "$NAME" )

# ---------------------------------------------------------------------------
# 4. Verify the finished zip, not the staging directory.
# ---------------------------------------------------------------------------

echo "==> Verifying $ZIP_PATH"

listing="$STAGE/zip-listing.txt"
unzip -Z1 "$ZIP_PATH" > "$listing"

warnings=0
while IFS= read -r entry; do
  [[ "$entry" == */ ]] && continue
  base="$(basename "$entry")"
  [[ "$base" == ".env.example" ]] && continue
  for g in "${SECRET_GLOBS[@]}"; do
    # shellcheck disable=SC2053
    if [[ "$base" == $g ]]; then
      echo "    WARNING: sensitive filename inside archive: $entry (matched $g)"
      warnings=$((warnings + 1))
      break
    fi
  done
done < "$listing"

if grep -qE '(^|/)\.git/' "$listing"; then
  echo "    WARNING: the archive contains a .git directory"
  warnings=$((warnings + 1))
fi
if grep -qE '(^|/)node_modules/' "$listing"; then
  echo "    WARNING: the archive contains node_modules"
  warnings=$((warnings + 1))
fi

entries="$(wc -l < "$listing" | tr -d ' ')"
size="$(du -h "$ZIP_PATH" | cut -f1 | tr -d ' ')"

echo
if [[ "$warnings" -gt 0 ]]; then
  echo "!!  $warnings warning(s). Inspect the archive before sending it."
  echo "    $ZIP_PATH  ($entries entries, $size)"
  exit 1
fi

echo "OK  $ZIP_PATH"
echo "    $entries entries, $size, no sensitive filename detected."

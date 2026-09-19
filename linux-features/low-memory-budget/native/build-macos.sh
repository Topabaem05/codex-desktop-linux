#!/bin/sh
set -eu
if [ "$(uname -s)" != Darwin ]; then
  printf '%s\n' 'This native observer must be compiled on macOS.' >&2
  exit 2
fi
here=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
out=${1:-"$here/macos-memory"}
# The helper is outside the signed app. Do not mutate/re-sign the upstream bundle.
xcrun clang -std=c11 -Wall -Wextra -Werror -O2 -fblocks \
  "$here/macos-memory.c" -o "$out"

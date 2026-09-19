#!/bin/sh
set -eu
value=${CODEX_MEMORY_JS_HEAP_MIB:-}
[ -n "$value" ] || exit 0
case "$value" in
  *[!0-9]*|'') printf '%s\n' 'Invalid CODEX_MEMORY_JS_HEAP_MIB' >&2; exit 2 ;;
esac
[ "${#value}" -eq 3 ] && [ "$value" -ge 128 ] && [ "$value" -le 768 ] || {
  printf '%s\n' 'CODEX_MEMORY_JS_HEAP_MIB must be 128..768 (experimental per-isolate limit)' >&2
  exit 2
}
for arg in "$@"; do
  case "$arg" in --js-flags*) printf '%s\n' 'Memory budget: preserving existing --js-flags.' >&2; exit 0 ;; esac
done
printf 'electron-arg --js-flags=--max-old-space-size=%s\n' "$value"

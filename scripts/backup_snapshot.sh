#!/bin/bash
set -euo pipefail

SUPA_URL="https://nyytjswemjrybjfmqaaq.supabase.co"
ANON="sb_publishable_2dpkprdkF6MM9EWHrbabHw_tir1tYAZ"

if [ -z "${SUPABASE_SERVICE_ROLE:-}" ]; then
  echo "❌ SUPABASE_SERVICE_ROLE not set."
  echo
  echo "Grab it from:"
  echo "  https://supabase.com/dashboard/project/nyytjswemjrybjfmqaaq/settings/api-keys"
  echo "  → 'service_role' secret key → Reveal → copy"
  echo
  echo "Then run:"
  echo "  export SUPABASE_SERVICE_ROLE='<paste-here>'"
  echo "  bash $0"
  exit 1
fi

STAMP=$(date +%Y-%m-%d_%H%M)
OUT="$HOME/wc26-xi/backups/$STAMP"
mkdir -p "$OUT"
echo "📦 Backup → $OUT"
echo

dump() {
  local table="$1" key="$2"
  local url="$SUPA_URL/rest/v1/$table?select=*"
  local limit=1000 offset=0 count=0
  local tmp="$OUT/$table.json"
  echo "[" > "$tmp"
  local first=1
  while true; do
    local resp
    resp=$(curl -s --max-time 60 \
      -H "apikey: $key" \
      -H "Authorization: Bearer $key" \
      -H "Range: $offset-$((offset+limit-1))" \
      "$url")
    local rows
    rows=$(echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d))" 2>/dev/null || echo 0)
    if [ "$rows" -eq 0 ]; then break; fi
    if [ "$first" -eq 0 ]; then echo "," >> "$tmp"; fi
    echo "$resp" | python3 -c "import sys,json; d=json.load(sys.stdin); print(',\n'.join(json.dumps(r) for r in d))" >> "$tmp"
    first=0
    count=$((count+rows))
    offset=$((offset+limit))
    printf "\r  %-20s %d rows" "$table" "$count"
    if [ "$rows" -lt "$limit" ]; then break; fi
  done
  echo "]" >> "$tmp"
  printf "\r  %-20s %d rows ✅\n" "$table" "$count"
}

# Public tables — use anon key (validates RLS hasn't accidentally locked us out)
dump teams "$ANON"
dump leagues "$ANON"
dump entries "$ANON"
dump entry_players "$ANON"

# Sensitive — service_role needed
dump profiles "$SUPABASE_SERVICE_ROLE"

echo
echo "📊 Summary:"
for f in teams leagues entries entry_players profiles; do
  rows=$(python3 -c "import json; print(len(json.load(open('$OUT/$f.json'))))" 2>/dev/null || echo "?")
  size=$(du -h "$OUT/$f.json" | cut -f1)
  printf "  %-18s %8s rows  %6s\n" "$f.json" "$rows" "$size"
done
echo
echo "✅ Done → $OUT"
echo
echo "To restore later (Postgres direct):"
echo "  python3 scripts/restore_snapshot.py $OUT"

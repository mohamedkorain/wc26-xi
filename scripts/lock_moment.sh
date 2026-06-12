#!/bin/bash
set -euo pipefail

SUPA_URL="https://nyytjswemjrybjfmqaaq.supabase.co"
ANON="sb_publishable_2dpkprdkF6MM9EWHrbabHw_tir1tYAZ"
LEAGUE_ID="11111111-1111-1111-1111-111111111111"

if [ -z "${SUPABASE_SERVICE_ROLE:-}" ]; then
  echo "❌ SUPABASE_SERVICE_ROLE not set. Export it first."
  exit 1
fi

echo "🔒 LOCK MOMENT REPORT — $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "═══════════════════════════════════════════════════════"
echo

# ─── 1. Verify lock fired (test write should fail with 42501) ───
echo "📋 [1/4] Verifying RLS lock fired…"
TEST_RESP=$(curl -s --max-time 10 -X POST \
  "$SUPA_URL/rest/v1/entries" \
  -H "apikey: $ANON" \
  -H "Authorization: Bearer $ANON" \
  -H "Content-Type: application/json" \
  -d '{"league_id":"'$LEAGUE_ID'","team_name":"LOCK_TEST","formation":"4-4-2","xi_json":[]}' \
  -w "\nHTTP:%{http_code}")
HTTP=$(echo "$TEST_RESP" | grep -oE 'HTTP:[0-9]+' | cut -d: -f2)
if [ "$HTTP" = "401" ] || [ "$HTTP" = "403" ]; then
  echo "   ✅ Lock is enforced (anon write rejected, HTTP $HTTP)"
else
  echo "   ⚠️  Unexpected HTTP $HTTP — check manually"
fi
echo

# ─── 2. Final entry count ───
echo "📊 [2/4] Final entry count…"
ENT=$(curl -s -X POST --max-time 5 "$SUPA_URL/rest/v1/rpc/entry_count" \
  -H "apikey: $ANON" \
  -H "Content-Type: application/json" \
  -d "{\"p_league_id\":\"$LEAGUE_ID\"}")
echo "   🏆 Total submitted squads: $ENT"
echo

# ─── 3. Total profiles ───
echo "👥 [3/4] Total signed-in users…"
PROF=$(curl -s --max-time 10 \
  "$SUPA_URL/rest/v1/profiles?select=id" \
  -H "apikey: $SUPABASE_SERVICE_ROLE" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE" \
  -H "Prefer: count=exact" -H "Range: 0-0" -I 2>&1 | grep -i "content-range" | sed 's/.*\///' | tr -d '\r\n')
echo "   👤 Total profiles: $PROF"
echo

# ─── 4. Golden master backup ───
echo "💾 [4/4] Running golden-master backup…"
bash "$(dirname "$0")/backup_snapshot.sh"
echo

echo "═══════════════════════════════════════════════════════"
echo "✅ LOCK MOMENT COMPLETE — tournament is officially live."

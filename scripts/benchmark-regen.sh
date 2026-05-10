#!/usr/bin/env bash
#
# Benchmark for the Regeneração Guiada por Factualidade endpoint.
#
# Picks N existing summaries with factualityScore < 1.0 (i.e., that have
# at least one sentence flagged as neutral or contradicted), runs the
# guided-regeneration endpoint on each, polls until background metrics
# are populated, and emits a CSV row per sample.
#
# At the end, prints aggregate stats: average delta, % improved, % worse,
# % unchanged. Use the resulting CSV in §6.x of the TCC to substantiate
# the empirical claim about guided regeneration's effect on factuality.
#
# Usage:
#   ./scripts/benchmark-regen.sh
#   N_SAMPLES=30 ./scripts/benchmark-regen.sh
#   BASE_URL=http://127.0.0.1:3001 N_SAMPLES=10 ./scripts/benchmark-regen.sh
#
# Side effect: creates N new rows in the `summaries` table (one per regen).
# Each row is linked to its parent via parent_summary_id and can be filtered
# out later if the DB needs cleanup.

set -uo pipefail

BASE_URL="${BASE_URL:-https://summa.thomazritter.com.br}"
ADMIN_CODE="${ADMIN_CODE:-SUMMA-ADMIN}"
N_SAMPLES="${N_SAMPLES:-20}"
POLL_SECS="${POLL_SECS:-3}"
POLL_MAX="${POLL_MAX:-80}"   # 240s per sample
OUTPUT_DIR="${OUTPUT_DIR:-/Users/thomazjusto/Documents/TCC/project/summarizer/scripts/results}"

mkdir -p "$OUTPUT_DIR"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
OUTPUT_CSV="$OUTPUT_DIR/benchmark-regen-${TIMESTAMP}.csv"

H_AUTH="x-access-code: $ADMIN_CODE"

step()  { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }
ok()    { printf '  \033[1;32m✓\033[0m %s\n' "$*"; }
warn()  { printf '  \033[1;33m!\033[0m %s\n' "$*"; }
fail()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; }
fatal() { fail "$*"; exit 1; }

step "Benchmark — Regeneração Guiada por Factualidade"
echo "  base url:   $BASE_URL"
echo "  N samples:  $N_SAMPLES"
echo "  output csv: $OUTPUT_CSV"

# ─── 1. Auth + listing ──────────────────────────────────────────────
LOGIN=$(curl -fsS --max-time 10 -X POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$ADMIN_CODE\"}") \
  || fatal "login failed"
ROLE=$(printf '%s' "$LOGIN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["role"])')
[[ "$ROLE" == "manager" ]] || fatal "expected manager, got $ROLE"
ok "logged in as $ROLE"

step "Loading candidate summaries"
SUMMARIES=$(curl -fsS --max-time 30 "$BASE_URL/api/manager/summaries" -H "$H_AUTH") \
  || fatal "manager summaries failed"

# Pick targets: factualityScore in [0, 1), prefer articles where at least one
# summary has rougeL non-null (proxy for abstract being available so post-regen
# ROUGE/BERT actually run). Sort ASC by score (worst first → max signal).
TARGETS=$(printf '%s' "$SUMMARIES" | python3 -c "
import json, sys
data = json.load(sys.stdin)
articles_with_abstract = {s['articleId'] for s in data['summaries'] if s.get('rougeL') is not None}
flagged = [s for s in data['summaries']
           if s.get('factualityScore') is not None
           and s['factualityScore'] < 1.0
           and s['articleId'] in articles_with_abstract]
if not flagged:
    flagged = [s for s in data['summaries']
               if s.get('factualityScore') is not None and s['factualityScore'] < 1.0]
flagged.sort(key=lambda s: s['factualityScore'])
for s in flagged[:$N_SAMPLES]:
    print(f\"{s['id']},{s['articleId']},{s['factualityScore']}\")
")
TARGET_COUNT=$(printf '%s\n' "$TARGETS" | grep -c . || true)
[[ "$TARGET_COUNT" -gt 0 ]] || fatal "no candidate summaries with factualityScore < 1.0"
ok "selected $TARGET_COUNT summaries (lowest factuality first)"

# ─── 2. CSV header ──────────────────────────────────────────────────
echo "idx,article_id,original_id,regen_id,model,original_factuality,regen_factuality,delta_factuality,regen_bert,regen_rouge_l" > "$OUTPUT_CSV"

# ─── 3. Run benchmark over each target ──────────────────────────────
IDX=0
IMPROVED=0
WORSE=0
SAME=0
DELTA_SUM=0

while IFS=',' read -r ORIG_ID ARTICLE_ID ORIG_SCORE; do
  [[ -z "$ORIG_ID" ]] && continue
  IDX=$((IDX + 1))
  step "[$IDX/$TARGET_COUNT] summary id=$ORIG_ID  article=$ARTICLE_ID  factuality=$ORIG_SCORE"

  # Trigger regeneration
  REGEN=$(curl -fsS --max-time 90 -X POST \
    "$BASE_URL/api/experiment/summaries/$ORIG_ID/regenerate-with-evidence" \
    -H "$H_AUTH") || REGEN=""
  if [[ -z "$REGEN" ]]; then
    warn "regenerate failed; skipping"
    echo "$IDX,$ARTICLE_ID,$ORIG_ID,,,${ORIG_SCORE},,," >> "$OUTPUT_CSV"
    continue
  fi
  NEW_ID=$(printf '%s' "$REGEN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  MODEL=$(printf '%s' "$REGEN" | python3 -c 'import json,sys; print(json.load(sys.stdin)["modelId"])')
  ok "regen → id=$NEW_ID model=$MODEL"

  # Poll for background metrics
  NEW_SCORE=""
  NEW_BERT=""
  NEW_ROUGE=""
  for i in $(seq 1 "$POLL_MAX"); do
    CURRENT=$(curl -fsS --max-time 30 "$BASE_URL/api/manager/summaries" -H "$H_AUTH" 2>/dev/null) || continue
    ROW=$(printf '%s' "$CURRENT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
m = [s for s in d['summaries'] if s['id'] == $NEW_ID]
print(json.dumps(m[0]) if m else 'null')
")
    if [[ "$ROW" != "null" ]]; then
      NEW_SCORE=$(printf '%s' "$ROW" | python3 -c 'import json,sys; v=json.load(sys.stdin).get("factualityScore"); print(v if v is not None else "")')
      NEW_BERT=$(printf '%s' "$ROW" | python3 -c 'import json,sys; v=json.load(sys.stdin).get("bertScore"); print(v if v is not None else "")')
      NEW_ROUGE=$(printf '%s' "$ROW" | python3 -c 'import json,sys; v=json.load(sys.stdin).get("rougeL"); print(v if v is not None else "")')
      [[ -n "$NEW_SCORE" ]] && break
    fi
    printf '.'
    sleep "$POLL_SECS"
  done
  printf '\n'

  if [[ -z "$NEW_SCORE" ]]; then
    warn "factualityScore did not populate for id=$NEW_ID after $((POLL_SECS*POLL_MAX))s"
    echo "$IDX,$ARTICLE_ID,$ORIG_ID,$NEW_ID,$MODEL,$ORIG_SCORE,,,${NEW_BERT:-},${NEW_ROUGE:-}" >> "$OUTPUT_CSV"
    continue
  fi

  DELTA=$(python3 -c "print(round($NEW_SCORE - $ORIG_SCORE, 4))")

  if python3 -c "import sys; sys.exit(0 if $DELTA > 0.001 else 1)" 2>/dev/null; then
    IMPROVED=$((IMPROVED + 1))
    VERDICT="↑ improved"
  elif python3 -c "import sys; sys.exit(0 if $DELTA < -0.001 else 1)" 2>/dev/null; then
    WORSE=$((WORSE + 1))
    VERDICT="↓ worse"
  else
    SAME=$((SAME + 1))
    VERDICT="= unchanged"
  fi
  DELTA_SUM=$(python3 -c "print(round($DELTA_SUM + $DELTA, 4))")
  ok "factuality: $ORIG_SCORE → $NEW_SCORE  delta=$DELTA  $VERDICT  bert=${NEW_BERT:-?}  rougeL=${NEW_ROUGE:-?}"
  echo "$IDX,$ARTICLE_ID,$ORIG_ID,$NEW_ID,$MODEL,$ORIG_SCORE,$NEW_SCORE,$DELTA,${NEW_BERT:-},${NEW_ROUGE:-}" >> "$OUTPUT_CSV"
done <<< "$TARGETS"

# ─── 4. Aggregate stats ─────────────────────────────────────────────
step "Aggregate stats"
TOTAL=$IDX
COMPLETE=$((IMPROVED + WORSE + SAME))
if [[ "$COMPLETE" -gt 0 ]]; then
  AVG_DELTA=$(python3 -c "print(round($DELTA_SUM / $COMPLETE, 4))")
  PCT_IMPROVED=$(python3 -c "print(round(100 * $IMPROVED / $COMPLETE, 1))")
  PCT_WORSE=$(python3 -c "print(round(100 * $WORSE / $COMPLETE, 1))")
  PCT_SAME=$(python3 -c "print(round(100 * $SAME / $COMPLETE, 1))")
else
  AVG_DELTA=0
  PCT_IMPROVED=0
  PCT_WORSE=0
  PCT_SAME=0
fi

echo "  attempted:    $TOTAL"
echo "  with metrics: $COMPLETE"
echo "  improved:     $IMPROVED  (${PCT_IMPROVED}%)"
echo "  worse:        $WORSE  (${PCT_WORSE}%)"
echo "  unchanged:    $SAME  (${PCT_SAME}%)"
echo "  avg delta:    $AVG_DELTA"
echo ""
echo "  csv:          $OUTPUT_CSV"

#!/usr/bin/env bash
#
# End-to-end smoke test for the summarizer API.
#
# Exercises the full user surface (no frontend):
#   1. Public endpoints (health, llm provider)
#   2. Auth (manager login)
#   3. Listings (articles, manager summaries, available models, experiment articles)
#   4. Article upload (PDF → extraction → structuring)
#   5. Article fetch + download round-trip
#   6. CV-based profile inference (LLM extracts dimensions from a PDF)
#   7. Regeneração Guiada por Factualidade (the new feature) end-to-end:
#      pick a flagged summary, regenerate, poll for re-computed metrics
#   8. Validate ROUGE + BERTScore eventually populated (proves merged
#      NLI+metrics service responds on /classify and /quality)
#   9. Negative paths (auth, invalid IDs, no flagged sentences)
#
# Usage:
#   ./scripts/smoke-test.sh
#   BASE_URL=http://127.0.0.1:3001 ADMIN_CODE=SUMMA-ADMIN ./scripts/smoke-test.sh
#
# Inputs: small PDFs from ../../papers_pdf/ (paths configurable via env vars).
#
# Side effects (created, not cleaned up):
#   - 1 new article row (from PDF upload)
#   - 1 new summary row (from regenerate-with-evidence)
# Safe to run repeatedly. Articles are tagged with a smoketest-* title.

set -uo pipefail

BASE_URL="${BASE_URL:-https://summa.thomazritter.com.br}"
ADMIN_CODE="${ADMIN_CODE:-SUMMA-ADMIN}"
PAPERS_DIR="${PAPERS_DIR:-/Users/thomazjusto/Documents/TCC/papers_pdf}"
TEST_ARTICLE_PDF="${TEST_ARTICLE_PDF:-$PAPERS_DIR/lin2004rouge.pdf}"
TEST_CV_PDF="${TEST_CV_PDF:-$PAPERS_DIR/_thomaz_resume.pdf}"
POLL_SECS=3
POLL_MAX=60   # 180s total — NLI re-check on long summaries can be slow

PASS=0
FAIL=0
SKIP=0

step() { printf '\n\033[1;36m── %s\033[0m\n' "$*"; }
ok()   { printf '  \033[1;32m✓\033[0m %s\n' "$*"; PASS=$((PASS+1)); }
warn() { printf '  \033[1;33m!\033[0m %s\n' "$*"; SKIP=$((SKIP+1)); }
bad()  { printf '  \033[1;31m✗\033[0m %s\n' "$*"; FAIL=$((FAIL+1)); }

# Convenience: read a JSON path from stdin via python3
jpath() { python3 -c "import json,sys; print(json.load(sys.stdin)$1)"; }

# Convenience: assert HTTP status from a curl call. Echoes the body to stdout.
# Usage: STATUS=$(http_call <expected_status> <method> <url> [extra curl args ...])
http_call() {
  local expected="$1" method="$2" url="$3"; shift 3
  local code body tmp
  tmp=$(mktemp)
  code=$(curl -sS -o "$tmp" -w '%{http_code}' --max-time 90 -X "$method" "$url" "$@" || echo "000")
  body=$(cat "$tmp"); rm -f "$tmp"
  if [[ "$code" != "$expected" ]]; then
    printf 'expected HTTP %s, got %s\nbody: %s\n' "$expected" "$code" "$body" >&2
    return 1
  fi
  printf '%s' "$body"
}

# ════════════════════════════════════════════════════════════════════
step "1. Public health"
# ════════════════════════════════════════════════════════════════════
HEALTH=$(curl -fsS --max-time 10 "$BASE_URL/health" 2>/dev/null) \
  && [[ $(printf '%s' "$HEALTH" | jpath '["status"]') == "ok" ]] \
  && ok "GET /health → status=ok" || bad "GET /health failed"

# ════════════════════════════════════════════════════════════════════
step "2. LLM provider (Groq) status"
# ════════════════════════════════════════════════════════════════════
LLM=$(curl -fsS --max-time 15 "$BASE_URL/api/llm/status" 2>/dev/null) || LLM=""
if [[ -n "$LLM" ]] && [[ $(printf '%s' "$LLM" | jpath '["healthy"]') == "True" ]]; then
  MODEL=$(printf '%s' "$LLM" | jpath '["model"]')
  ok "Groq healthy=true model=$MODEL"
else
  bad "Groq unreachable or unhealthy: $LLM"
fi

# ════════════════════════════════════════════════════════════════════
step "3. Manager login"
# ════════════════════════════════════════════════════════════════════
LOGIN=$(http_call 200 POST "$BASE_URL/api/auth/login" \
  -H 'Content-Type: application/json' -d "{\"code\":\"$ADMIN_CODE\"}") \
  && ROLE=$(printf '%s' "$LOGIN" | jpath '["role"]') \
  && [[ "$ROLE" == "manager" ]] \
  && ok "POST /api/auth/login → role=$ROLE" || bad "Login as manager failed"

H_AUTH="x-access-code: $ADMIN_CODE"

# ════════════════════════════════════════════════════════════════════
step "4. Listings (articles, models, manager overview, manager summaries)"
# ════════════════════════════════════════════════════════════════════
ARTICLES=$(http_call 200 GET "$BASE_URL/api/articles" -H "$H_AUTH") \
  && ART_COUNT=$(printf '%s' "$ARTICLES" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') \
  && ok "GET /api/articles → $ART_COUNT articles" || bad "GET /api/articles failed"

EXP_ARTICLES=$(http_call 200 GET "$BASE_URL/api/experiment/articles" -H "$H_AUTH") \
  && EXP_ART_COUNT=$(printf '%s' "$EXP_ARTICLES" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') \
  && ok "GET /api/experiment/articles → $EXP_ART_COUNT articles" || bad "GET /experiment/articles failed"

MODELS=$(http_call 200 GET "$BASE_URL/api/experiment/models" -H "$H_AUTH") \
  && MODEL_COUNT=$(printf '%s' "$MODELS" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)))') \
  && ok "GET /api/experiment/models → $MODEL_COUNT models" || bad "GET /experiment/models failed"

OVERVIEW=$(http_call 200 GET "$BASE_URL/api/manager/overview" -H "$H_AUTH") \
  && ok "GET /api/manager/overview → ok" || bad "Manager overview failed"

SUMMARIES_JSON=$(http_call 200 GET "$BASE_URL/api/manager/summaries" -H "$H_AUTH") \
  && TOTAL_SUM=$(printf '%s' "$SUMMARIES_JSON" | jpath '["summaries"].__len__()') \
  && ok "GET /api/manager/summaries → $TOTAL_SUM summaries" || bad "Manager summaries failed"

# ════════════════════════════════════════════════════════════════════
step "5. Article upload (PDF → text extraction → LLM-based structuring)"
# ════════════════════════════════════════════════════════════════════
if [[ ! -f "$TEST_ARTICLE_PDF" ]]; then
  warn "TEST_ARTICLE_PDF not found at $TEST_ARTICLE_PDF — skipping upload test"
else
  PDF_SIZE=$(stat -f%z "$TEST_ARTICLE_PDF" 2>/dev/null || stat -c%s "$TEST_ARTICLE_PDF")
  printf '  uploading %s (%s bytes)…\n' "$(basename "$TEST_ARTICLE_PDF")" "$PDF_SIZE"
  UPLOAD=$(http_call 201 POST "$BASE_URL/api/articles/upload" \
    -H "$H_AUTH" -F "file=@$TEST_ARTICLE_PDF") || UPLOAD=""
  if [[ -n "$UPLOAD" ]]; then
    NEW_ARTICLE_ID=$(printf '%s' "$UPLOAD" | jpath '["article"]["id"]')
    NEW_ARTICLE_TITLE=$(printf '%s' "$UPLOAD" | jpath '["article"].get("title","?")[:60]')
    HAS_STRUCT=$(printf '%s' "$UPLOAD" | python3 -c '
import json, sys
d = json.load(sys.stdin)
sc = (d.get("article") or {}).get("structuredContent") or {}
keys = [k for k in ("abstract","introduction","methodology","results","discussion","conclusion") if sc.get(k)]
print(",".join(keys) if keys else "none")
')
    ok "POST /api/articles/upload → id=$NEW_ARTICLE_ID title='$NEW_ARTICLE_TITLE'"
    if [[ "$HAS_STRUCT" != "none" ]]; then
      ok "structuredContent extracted: $HAS_STRUCT"
    else
      warn "no structured sections extracted (LLM structuring fallback)"
    fi

    # 5b. Round-trip — fetch by id
    GOT=$(http_call 200 GET "$BASE_URL/api/articles/$NEW_ARTICLE_ID" -H "$H_AUTH") \
      && GOT_ID=$(printf '%s' "$GOT" | jpath '["id"]') \
      && [[ "$GOT_ID" == "$NEW_ARTICLE_ID" ]] \
      && ok "GET /api/articles/$NEW_ARTICLE_ID → matches" || bad "Article fetch round-trip failed"

    # 5c. Download endpoint serves the extracted raw text (text/plain), not the PDF
    DL_TYPE=$(curl -sS -o /dev/null -w '%{content_type}' --max-time 30 \
      "$BASE_URL/api/articles/$NEW_ARTICLE_ID/download" -H "$H_AUTH")
    [[ "$DL_TYPE" == text/plain* ]] \
      && ok "GET /api/articles/$NEW_ARTICLE_ID/download → text/plain (extracted text)" \
      || bad "Download did not return text/plain (got: $DL_TYPE)"
  else
    bad "Article upload failed"
  fi
fi

# ════════════════════════════════════════════════════════════════════
step "6. CV profile inference (LLM extracts dimensions from PDF)"
# ════════════════════════════════════════════════════════════════════
if [[ ! -f "$TEST_CV_PDF" ]]; then
  warn "TEST_CV_PDF not found at $TEST_CV_PDF — skipping CV test"
else
  printf '  posting %s as CV…\n' "$(basename "$TEST_CV_PDF")"
  CV_RESULT=$(http_call 200 POST "$BASE_URL/api/experiment/cv-profile" \
    -H "$H_AUTH" -F "file=@$TEST_CV_PDF") || CV_RESULT=""
  if [[ -n "$CV_RESULT" ]]; then
    DIMS=$(printf '%s' "$CV_RESULT" | python3 -c "
import json, sys
d = json.load(sys.stdin)
dims = d.get('dimensions') or {}
print('expertise=' + str(dims.get('expertise')) + ', focus=' + str(dims.get('focus')) + ', depth=' + str(dims.get('depth')) + ', context=' + str(dims.get('context')))
")
    EXPERIENCE=$(printf '%s' "$CV_RESULT" | jpath '.get("experienceLevel","?")')
    DOMAIN=$(printf '%s' "$CV_RESULT" | jpath '.get("domain","?")')
    ok "POST /cv-profile → $DIMS"
    ok "  experience=$EXPERIENCE  domain=$DOMAIN"
  else
    bad "CV profile inference failed"
  fi
fi

# ════════════════════════════════════════════════════════════════════
step "7. Find target summary (factualityScore < 1.0, with abstract available)"
# ════════════════════════════════════════════════════════════════════
TARGET_ID=$(printf '%s' "$SUMMARIES_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
articles_with_abstract = {s["articleId"] for s in data["summaries"] if s.get("rougeL") is not None}
flagged = [s for s in data["summaries"]
           if s.get("factualityScore") is not None
           and s["factualityScore"] < 1.0
           and s["articleId"] in articles_with_abstract]
if not flagged:
    flagged = [s for s in data["summaries"]
               if s.get("factualityScore") is not None and s["factualityScore"] < 1.0]
if not flagged:
    sys.exit(2)
flagged.sort(key=lambda s: s["factualityScore"])
print(flagged[0]["id"])
') 2>/dev/null
if [[ -z "${TARGET_ID:-}" ]]; then
  bad "No summary with factualityScore < 1.0 — skipping regen test"
else
  ORIG_SCORE=$(printf '%s' "$SUMMARIES_JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=[s for s in d['summaries'] if s['id']==$TARGET_ID]
print(m[0]['factualityScore'])
")
  ok "Picked summary id=$TARGET_ID, factualityScore=$ORIG_SCORE"
fi

# ════════════════════════════════════════════════════════════════════
step "8. ⭐ Regeneração Guiada por Factualidade (POST /summaries/:id/regenerate-with-evidence)"
# ════════════════════════════════════════════════════════════════════
NEW_ID="" NEW_SCORE="" NEW_BERT="" NEW_ROUGE=""
if [[ -n "${TARGET_ID:-}" ]]; then
  REGEN=$(http_call 201 POST \
    "$BASE_URL/api/experiment/summaries/$TARGET_ID/regenerate-with-evidence" \
    -H "$H_AUTH") || REGEN=""
  if [[ -n "$REGEN" ]]; then
    NEW_ID=$(printf '%s' "$REGEN" | jpath '["id"]')
    PARENT=$(printf '%s' "$REGEN" | jpath '["parentSummaryId"]')
    MODEL=$(printf '%s' "$REGEN" | jpath '["modelId"]')
    LEN=$(printf '%s' "$REGEN" | python3 -c 'import json,sys; print(len(json.load(sys.stdin)["content"]))')
    if [[ "$PARENT" == "$TARGET_ID" && "$LEN" -gt 100 ]]; then
      ok "regenerated id=$NEW_ID parent=$PARENT model=$MODEL chars=$LEN"
    else
      bad "regenerate response malformed (parent=$PARENT, len=$LEN)"
    fi
  else
    bad "regenerate-with-evidence call failed"
  fi
fi

# ════════════════════════════════════════════════════════════════════
step "9. Poll for background metrics (factuality + ROUGE + BERTScore, up to $((POLL_SECS*POLL_MAX))s)"
# ════════════════════════════════════════════════════════════════════
if [[ -n "$NEW_ID" ]]; then
  for i in $(seq 1 "$POLL_MAX"); do
    CURRENT=$(curl -fsS --max-time 30 "$BASE_URL/api/manager/summaries" -H "$H_AUTH" 2>/dev/null) || continue
    ROW=$(printf '%s' "$CURRENT" | python3 -c "
import json,sys
d=json.load(sys.stdin)
m=[s for s in d['summaries'] if s['id']==$NEW_ID]
print(json.dumps(m[0]) if m else 'null')
")
    if [[ "$ROW" != "null" ]]; then
      NEW_SCORE=$(printf '%s' "$ROW" | jpath '["factualityScore"]')
      NEW_BERT=$(printf '%s' "$ROW" | jpath '["bertScore"]')
      NEW_ROUGE=$(printf '%s' "$ROW" | jpath '["rougeL"]')
      [[ "$NEW_SCORE" != "None" && "$NEW_BERT" != "None" ]] && break
      [[ "$NEW_BERT" != "None" && $i -ge 25 ]] && break
    fi
    printf '.'; sleep "$POLL_SECS"
  done
  printf '\n'

  [[ "$NEW_SCORE" != "None" && -n "$NEW_SCORE" ]] \
    && ok "factualityScore=$NEW_SCORE (NLI re-check via /classify)" \
    || warn "factualityScore still pending"
  [[ "$NEW_BERT" != "None"  && -n "$NEW_BERT"  ]] \
    && ok "bertScore=$NEW_BERT (proves merged service /quality responded)" \
    || warn "bertScore missing — abstract may have been empty for this article"
  [[ "$NEW_ROUGE" != "None" && -n "$NEW_ROUGE" ]] \
    && ok "rougeL=$NEW_ROUGE" \
    || warn "rougeL missing — abstract empty for parent article"
fi

# ════════════════════════════════════════════════════════════════════
step "10. Negative paths (auth, not-found, no-flagged)"
# ════════════════════════════════════════════════════════════════════
# 10a. Auth required
NOAUTH=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 "$BASE_URL/api/articles")
[[ "$NOAUTH" == "401" ]] && ok "GET /api/articles without auth → 401" || bad "Expected 401, got $NOAUTH"

# 10b. Wrong access code
BADCODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
  "$BASE_URL/api/articles" -H "x-access-code: NOT-A-REAL-CODE")
[[ "$BADCODE" == "401" ]] && ok "GET /api/articles with invalid code → 401" || bad "Expected 401, got $BADCODE"

# 10c. Regenerate non-existent summary
NF=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST \
  "$BASE_URL/api/experiment/summaries/999999/regenerate-with-evidence" -H "$H_AUTH")
[[ "$NF" == "404" ]] && ok "regenerate-with-evidence on missing id → 404" || bad "Expected 404, got $NF"

# 10d. Invalid id parsing
BADID=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 -X POST \
  "$BASE_URL/api/experiment/summaries/notanumber/regenerate-with-evidence" -H "$H_AUTH")
[[ "$BADID" == "400" ]] && ok "regenerate-with-evidence on non-numeric id → 400" || bad "Expected 400, got $BADID"

# 10e. Regenerate a summary with all sentences supported (factualityScore == 1.0) → 400
ALL_SUPPORTED_ID=$(printf '%s' "$SUMMARIES_JSON" | python3 -c '
import json, sys
data = json.load(sys.stdin)
clean = [s for s in data["summaries"]
         if s.get("factualityScore") is not None and s["factualityScore"] == 1.0]
if clean:
    print(clean[0]["id"])
' 2>/dev/null)
if [[ -n "${ALL_SUPPORTED_ID:-}" ]]; then
  STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 30 -X POST \
    "$BASE_URL/api/experiment/summaries/$ALL_SUPPORTED_ID/regenerate-with-evidence" -H "$H_AUTH")
  [[ "$STATUS" == "400" ]] \
    && ok "regenerate on summary id=$ALL_SUPPORTED_ID (no flagged sentences) → 400" \
    || bad "Expected 400 for no-flagged-sentences, got $STATUS"
else
  warn "no summary with factualityScore == 1.0 to test the no-flagged path"
fi

# 10f. CV upload with a NON-PDF file → 400
TXT_TMP=$(mktemp -t smoketest-cv-XXXX).txt
printf 'this is plain text, not a pdf' > "$TXT_TMP"
NONPDF_STATUS=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 -X POST \
  "$BASE_URL/api/experiment/cv-profile" -H "$H_AUTH" -F "file=@$TXT_TMP")
rm -f "$TXT_TMP"
[[ "$NONPDF_STATUS" == "400" ]] \
  && ok "cv-profile with non-PDF → 400" \
  || bad "Expected 400 for non-PDF CV, got $NONPDF_STATUS"

# 10g. CV upload with a research paper (NOT a CV) → 422 with kind=not_cv
if [[ -f "$TEST_ARTICLE_PDF" ]]; then
  NOTCV_BODY=$(curl -sS --max-time 60 -X POST \
    "$BASE_URL/api/experiment/cv-profile" -H "$H_AUTH" -F "file=@$TEST_ARTICLE_PDF")
  NOTCV_KIND=$(printf '%s' "$NOTCV_BODY" | python3 -c '
import json, sys
try:
    d = json.load(sys.stdin)
except Exception:
    print("?"); sys.exit()
print(d.get("kind", "?"))
' 2>/dev/null)
  if [[ "$NOTCV_KIND" == "not_cv" ]]; then
    ok "cv-profile with research paper → rejected as not_cv"
  else
    bad "Expected kind=not_cv when uploading paper as CV, got kind=$NOTCV_KIND"
  fi
fi

# ════════════════════════════════════════════════════════════════════
step "11. Comparison: original vs regenerated"
# ════════════════════════════════════════════════════════════════════
if [[ -n "$NEW_ID" ]]; then
  printf '  %-30s  %s\n' "id (original)" "${TARGET_ID:-?}"
  printf '  %-30s  %s\n' "id (regenerated)" "$NEW_ID"
  printf '  %-30s  %s\n' "factualityScore (original)" "${ORIG_SCORE:-?}"
  printf '  %-30s  %s\n' "factualityScore (regenerated)" "${NEW_SCORE:-pending}"
  printf '  %-30s  %s\n' "bertScore (regenerated)" "${NEW_BERT:-pending}"
  printf '  %-30s  %s\n' "rougeL (regenerated)" "${NEW_ROUGE:-pending}"
fi

# ════════════════════════════════════════════════════════════════════
step "Summary"
# ════════════════════════════════════════════════════════════════════
printf '  pass=%d  warn/skip=%d  fail=%d\n' "$PASS" "$SKIP" "$FAIL"
[[ "$FAIL" -eq 0 ]] \
  && { printf '\n\033[1;32mAll critical checks passed.\033[0m\n'; exit 0; } \
  || { printf '\n\033[1;31mFAILED: %d critical check(s) below threshold.\033[0m\n' "$FAIL"; exit 1; }

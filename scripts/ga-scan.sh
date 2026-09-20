#!/bin/bash
# READ-ONLY scan of production tick outcomes observed by GitHub Actions.
# Downloads every bot-tick.yml run log and extracts the tick JSON line.
# No code changes, no writes to production — log fetch only.
set -u
PAT="GITHUB_PAT_REDACTED"
REPO="handokov/cryptopulse"
WORK=/home/z/my-project/scripts/ga_work
RUNS="$WORK/runs.tsv"
RAW="$WORK/ticks_raw.txt"
mkdir -p "$WORK"
: > "$RUNS"

# 1) list all runs (id, created_at, conclusion)
page=1
while :; do
  resp=$(curl -sS -H "Authorization: Bearer $PAT" \
    "https://api.github.com/repos/$REPO/actions/workflows/bot-tick.yml/runs?per_page=100&page=$page")
  n=$(printf '%s' "$resp" | python3 -c "import json,sys;print(len(json.load(sys.stdin).get('workflow_runs',[])))")
  printf '%s' "$resp" | python3 -c "
import json,sys
for r in json.load(sys.stdin).get('workflow_runs',[]):
    print(r['id'], r['created_at'], r['conclusion'], sep='\t')
" >> "$RUNS"
  [ "$n" -lt 100 ] && break
  page=$((page+1))
done
echo "runs total: $(wc -l < "$RUNS")"
sort -t$'\t' -k2 "$RUNS" -o "$RUNS"
echo "oldest: $(head -1 "$RUNS" | cut -f2)   newest: $(tail -1 "$RUNS" | cut -f2)"

# 2) download all run logs in parallel and extract the tick JSON line
: > "$RAW"
fetch_one() {
  local id="$1" date="$2"
  local zip="$WORK/$id.zip" dir="$WORK/$id"
  curl -sSL --retry 2 -H "Authorization: Bearer $PAT" \
    "https://api.github.com/repos/$REPO/actions/runs/$id/logs" -o "$zip" || return 0
  [ -s "$zip" ] || return 0
  rm -rf "$dir"; mkdir -p "$dir"
  unzip -q -o "$zip" -d "$dir" 2>/dev/null || return 0
  # tick JSON is the curl stdout of the "Call bot tick endpoint" step
  rg -I -o '\{"ok":true.*' "$dir" 2>/dev/null | head -1 | sed "s/^/$date $id /" >> "$RAW"
  rm -rf "$dir" "$zip"
}
export -f fetch_one
export PAT REPO WORK RAW
cut -f1,2 "$RUNS" | \
  xargs -P 8 -L 1 bash -c 'fetch_one "$1" "$2"' _

echo "tick lines extracted: $(wc -l < "$RAW")"

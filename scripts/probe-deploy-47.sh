#!/usr/bin/env bash
# Task 23-closure — fast production probe for commit (47) badge fix.
# Parallel chunk scan (needle: new legacy-fallback strings in exitReasonKey)
# + build-46 old-chunk 404 control.
BASE="https://cryptopulse-iota-self.vercel.app"
LIST=/home/z/my-project/scripts/.probe-chunks.txt

curl -s --max-time 20 -H "User-Agent: Mozilla/5.0" "$BASE/" \
  | grep -oE '/_next/static/chunks/[a-zA-Z0-9._-]+\.js' | sort -u > "$LIST"
echo "chunks referenced by HTML: $(wc -l < "$LIST")"

sed "s|^|$BASE|" "$LIST" | xargs -P 10 -I{} sh -c \
  'curl -s --max-time 10 "{}" | grep -q -e "≥ target" -e "≤ stop" && echo "NEEDLE-HIT {}"' \
  | head -3

CODE=$(curl -s -o /dev/null -w "%{http_code}" --max-time 15 \
  "$BASE/_next/static/chunks/e6c997313545564a.js")
echo "old build-46 bot-section chunk → HTTP $CODE (expect 404)"

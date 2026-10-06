#!/bin/sh
# Overall progress of the graphics render (tools/render-gfx.sh): 6 segments, 819 frames.
cd "$(dirname "$0")/../out/gfx"
done=0
for j in aK:168 aW:168 cK:51 cW:51 bK:336 dK:45; do
  n=${j%%:*}; f=${j##*:}
  if grep -q "DONE $n" progress.txt 2>/dev/null; then done=$((done+f)); echo "  $n  done ($f frames)";
  elif grep -q "START $n" progress.txt 2>/dev/null; then cur=$(tr '\r' '\n' < $n.log | grep -o "frame [0-9]*/[0-9]*" | tail -1 | cut -d' ' -f2 | cut -d/ -f1); done=$((done+${cur:-0})); echo "  $n  rendering ${cur:-0}/$f";
  else echo "  $n  waiting ($f frames)"; fi
done
echo "OVERALL: $((done*100/819))%  ($done/819 frames)"
if grep -q "COMPOSITE START" progress.txt 2>/dev/null; then
  us=$(grep "^out_time_us=" ../composite.progress 2>/dev/null | tail -1 | cut -d= -f2)
  if grep -q "COMPOSITE EXIT 0" progress.txt; then echo "FINAL ASSEMBLY: done"; else echo "FINAL ASSEMBLY: $(( ${us:-0} / 200000 ))%  ($(( ${us:-0} / 1000000 )) of 20 seconds)"; fi
else echo "FINAL ASSEMBLY: waiting for graphics"; fi

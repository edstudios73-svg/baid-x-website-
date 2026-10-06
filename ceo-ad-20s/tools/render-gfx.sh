#!/bin/sh
# Graphics in segments: over black (K) and, where the studio shows through, also over white (W) -> exact alpha in the composite.
cd "$(dirname "$0")/../v2"
R=/home/user/blackboy-store/.claude/skills/apple-style-motion/scripts/render.mjs; CH=/opt/pw-browsers/chromium-1194/chrome-linux/chrome
mkdir -p ../out/gfx; P=../out/gfx/progress.txt; : > $P
job() { echo "START $1" >> $P; node $R $2 --chrome $CH --scale 2 --ss 1 --no-sfx --from $3 --to $4 --out ../out/gfx/$1.mp4 > ../out/gfx/$1.log 2>&1 || { echo "FAIL $1" >> $P; exit 1; }; echo "DONE $1 $(ffprobe -v error -select_streams v -show_entries stream=nb_frames -of csv=p=0 ../out/gfx/$1.mp4) frames" >> $P; }
job aK gfxk.html 0 5.6
job aW gfxw.html 0 5.6
job cK gfxk.html 16.8 18.5
job cW gfxw.html 16.8 18.5
job bK gfxk.html 5.6 16.8
job dK gfxk.html 18.5 20
echo ALLDONE >> $P

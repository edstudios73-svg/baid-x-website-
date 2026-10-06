#!/bin/sh
# Graded plate (black shirt, dark desk, small lift) + its matte.  usage: tools/plate.sh <raw.mp4> <out-color.mp4> <out-mask.mp4> [input args]
set -e
IN="$1"; OC="$2"; OM="$3"; shift 3; X="$*"
cd "$(dirname "$0")/.."
tools/key.sh "$IN" "$OM" $X
GR=$(python3 tools/grade.py "${OM%.mp4}.head.txt")
ffmpeg -v error -y $X -i "$IN" -filter_complex "$GR;[graded]eq=brightness=0.015:contrast=1.03:saturation=1.02[o]" -map "[o]" -c:v libx264 -crf 10 -pix_fmt yuv444p "$OC"

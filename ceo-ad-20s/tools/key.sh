#!/bin/sh
# Person matte for the CEO plate: wall keyed by low saturation + lightness, holes filled, specks removed (tools/matte.py).
# usage: tools/key.sh <in.mp4> <out-mask.mp4> [extra ffmpeg input args, e.g. "-ss 6 -frames:v 1"]
set -e
IN="$1"; OUT="$2"; shift 2; X="$*"
cd "$(dirname "$0")/.."
M='max(max(r(X,Y),g(X,Y)),b(X,Y))'; m='min(min(r(X,Y),g(X,Y)),b(X,Y))'
P="(min(r(X,Y),b(X,Y))-g(X,Y))/max(${M},1)"   # magenta-ness: the pink shirt is >0.05, the grey wall <0.01
KEY="clip(max(max(((${M}-${m})/max(${M},1)-0.09)/0.07,(110-${M})/30),(${P}-0.015)/0.025),0,1)*255"
FR=$(ffprobe -v error -select_streams v:0 -show_entries stream=r_frame_rate -of default=nw=1:nk=1 "$IN")
# 1) solid silhouette at 1/4 resolution
ffmpeg -v error $X -i "$IN" -vf "scale=270:480,format=rgb24,geq=r='$KEY':g=0:b=0,format=gbrp,extractplanes=r" -f rawvideo -pix_fmt gray - \
 | python3 tools/matte.py 270 480 3 > /tmp/solid.raw
# 2) fine key at full resolution, gated by the dilated silhouette, plus the eroded silhouette as a solid core
ffmpeg -v error -y $X -i "$IN" -f rawvideo -pix_fmt gray -s 270x480 -r "$FR" -i /tmp/solid.raw -filter_complex "
[0:v]format=rgb24,geq=r='$KEY':g=0:b=0,format=gbrp,extractplanes=r,gblur=sigma=0.8[f];
[1:v]scale=1080:1920:flags=bilinear,format=gray,split[s1][s2];
[s1]dilation,dilation,dilation,gblur=sigma=3[sd];
[s2]erosion,erosion,erosion,erosion,erosion,erosion,gblur=sigma=4[se];
[f][sd]blend=all_mode=darken[fg];[fg][se]blend=all_mode=lighten,format=gray[a]" -map "[a]" -c:v libx264 -crf 8 -pix_fmt yuv420p "$OUT"

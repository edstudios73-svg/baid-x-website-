#!/bin/sh
# Final 4K composite: studio (still) + CEO plate (keyed, black shirt) + desk gear (still) -> camera move -> graphics -> score + sfx.
set -e
cd "$(dirname "$0")/.."
OUT=${1:-out/baidx-ceo-ad-20s-4k.mp4}
sw() { echo "if(lt($1,0.5),16*pow($1,5),1-pow(-2*$1+2,5)/2)"; }
T="(on/30)"
P1="(($T-2)/0.9)"; P2="(($T-3)/0.5)"
S="if(lt($T,2),1+0.02*$T,if(lt($T,2.9),1.04+0.16*$(sw $P1),if(lt($T,3),1.2,if(lt($T,3.5),1.2-0.18*$(sw $P2),if(lt($T,5),1.02+0.04*($T-3.5)/1.5,if(lt($T,17),1.06,if(lt($T,18),1.06+0.04*($T-17),1.1)))))))"
TY="if(lt($T,2),0,if(lt($T,2.9),-460*$(sw $P1),if(lt($T,3),-460,if(lt($T,3.5),-460+460*$(sw $P2),0))))"
# person prep: feather the plate's own edges (the drawn desk continues past them), decontaminate edge colour, scale into place
PREP="fps=30,format=rgba,geq=r='r(X,Y)*if(lt(alpha(X,Y),247),pow(alpha(X,Y)/255,0.8),1)':g='g(X,Y)*if(lt(alpha(X,Y),247),pow(alpha(X,Y)/255,0.8),1)':b='b(X,Y)*if(lt(alpha(X,Y),247),pow(alpha(X,Y)/255,0.8),1)':a='alpha(X,Y)*clip(X/46,0,1)*clip((1080-X)/46,0,1)*clip((1920-Y)/140,0,1)',scale=1858:3302:flags=lanczos,unsharp=5:5:0.45:5:5:0"
ffmpeg -v error -stats -y \
  -loop 1 -framerate 30 -t 20 -i out/bg/t1_00.png \
  -i out/plate/a-color.mp4 -i out/plate/a-mask.mp4 \
  -i out/plate/b-color.mp4 -i out/plate/b-mask.mp4 \
  -loop 1 -framerate 30 -t 20 -i out/desk/t1_00.png \
  -i out/gfx/aK.mp4 -i out/gfx/bK.mp4 -i out/gfx/cK.mp4 -i out/gfx/dK.mp4 -i out/gfx/aW.mp4 -i out/gfx/cW.mp4 -i out/sfx.wav -i assets/audio/music.wav \
  -filter_complex "
[1:v]format=rgb24[ac];[2:v]format=gray[am];[ac][am]alphamerge,$PREP,setpts=PTS-STARTPTS[pa];
[3:v]format=rgb24[bc];[4:v]format=gray[bm];[bc][bm]alphamerge,$PREP,setpts=PTS-STARTPTS+16.9/TB[pb];
[0:v]format=rgba[bg];
[bg][pa]overlay=151:334:eof_action=pass:format=auto[w1];
[w1][pb]overlay=151:334:eof_action=pass:format=auto:enable='between(t,16.9,18.2)'[w2];
[5:v]format=rgba[dk];[w2][dk]overlay=0:0:format=auto[w3];
[w3]format=rgb24,zoompan=z='$S':x='1080*(1-1/zoom)':y='1920-(1920+($TY))/zoom':d=1:s=2160x3840:fps=30[world];
[7:v]split[bK1][bK2];[9:v]split[dK1][dK2];
[6:v][bK1][8:v][dK1]concat=n=4:v=1:a=0,format=gbrp,split=2[K1][K2];
[10:v][bK2][11:v][dK2]concat=n=4:v=1:a=0,format=gbrp[W];
[W][K1]blend=all_expr='A-B'[D];
[world]format=gbrp[wg];[wg][D]blend=all_mode=multiply[T];[T][K2]blend=all_mode=addition,format=yuv420p[v];
[12:a][13:a]amix=inputs=2:normalize=0:weights='0.55 1',loudnorm=I=-14.5:TP=-2:LRA=11,aresample=48000[a]" \
  -map "[v]" -map "[a]" -t 20 -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -level 5.2 -c:a aac -b:a 256k -movflags +faststart "$OUT"
echo done "$OUT"

#!/bin/sh
# Mix the score stems (score.py) into music.wav: space, width, the drop before the impact, master.
cd "$(dirname "$0")"
DYN="if(lt(t,3),0.75,if(lt(t,8.8),0.9,if(lt(t,10.86),0.8,if(lt(t,11),0.05,1))))"
ffmpeg -v error -y -i pad.wav -i bass.wav -i arp.wav -i drums.wav -i fx.wav -filter_complex "
[0:a]volume=0.55,aecho=0.8:0.6:70|130:0.35|0.22,pan=stereo|c0=c0|c1=c0,adelay=0|14[pd];
[1:a]volume=0.6,pan=stereo|c0=c0|c1=c0[bs];
[2:a]volume=0.34,aecho=0.8:0.55:250|375:0.28|0.16,pan=stereo|c0=c0|c1=c0,adelay=9|0[ar];
[3:a]volume=0.8,aecho=0.8:0.4:35:0.18,pan=stereo|c0=c0|c1=c0[dr];
[4:a]volume=0.75,aecho=0.8:0.5:90|160:0.3|0.2,pan=stereo|c0=c0|c1=c0,adelay=0|6[fx];
[pd][bs][ar][dr]amix=inputs=4:normalize=0,volume='$DYN':eval=frame[mus];
[mus][fx]amix=inputs=2:normalize=0,acompressor=threshold=-14dB:ratio=3:attack=8:release=120:makeup=2,alimiter=limit=0.9:level=false,aresample=48000[a]" -map "[a]" -t 20 music.wav

"""Print an ffmpeg filter graph (input [0:v] = plate) that outputs [graded]:
pink shirt -> black shirt (folds kept from luminance), light wood desk -> dark studio desk.
Skin is told apart from the pink shirt by hue: skin has green above blue (warm), the shirt has blue >= green (magenta).
Masks are blurred before blending so compression blocks never show. Nothing above y=FACE_Y (the face) is recoloured."""
import sys
# face line = head top + 232 px (below the mouth and chin), tracked per frame (head.txt from tools/key.sh); piecewise-linear over the frame number N
rows = [list(map(float, l.split())) for l in open(sys.argv[1]).read().strip().splitlines()] if len(sys.argv) > 1 else [[540.0, 540.0]]
rows = [r if len(r) > 1 else [r[0], 540.0] for r in rows]
def track(col, add):
    vals = [r[col] for r in rows]; step = 6
    kn = [(i, sum(vals[max(0, i - 3):i + 4]) / len(vals[max(0, i - 3):i + 4])) for i in range(0, len(vals), step)]
    if len(kn) == 1: return f'{kn[0][1] + add:.1f}'
    e = f'{kn[-1][1] + add:.1f}'
    for (n0, a), (n1, b) in reversed(list(zip(kn, kn[1:]))):
        e = f'if(lt(N,{n1}),{a + add:.1f}+({b - a:.2f})*(N-{n0})/{n1 - n0},{e})'
    return f'({e})'
FACE_Y = track(0, 232)   # face line: head top + 232 px (below mouth and chin), tracked per frame
HEAD_X = track(1, 0)     # head centre x, tracked per frame
R, G, B = 'r(X,Y)', 'g(X,Y)', 'b(X,Y)'
L = f'(({R}+{G}+{B})/3)'
zone = f'(1-(1-clip((Y-{FACE_Y})/10,0,1))*clip((128-abs(X-{HEAD_X}))/20,0,1))*clip((1300-Y)/20,0,1)'           # below the chin, above the desk
# The pink shirt is far brighter than dark skin, so brightness does most of the work:
lit = f'clip(({L}-108)/14,0,1)'                                       # bright = fabric ...
palm = f'(clip(({G}-{B}-11)/6,0,1)*clip(({R}-{G}-14)/8,0,1))'         # ... unless strongly warm (palms, nails)
pinkd = f'(clip(({B}-{G}-5)/5,0,1)*clip(({L}-92)/12,0,1))'           # shadowed fabric is still magenta (blue > green)
neck = f"(1-(1-clip((Y-{FACE_Y}-70)/25,0,1))*clip((150-abs(X-{HEAD_X}))/40,0,1))"                                # just under the chin only clear fabric changes
shirt = f"clip(max({lit}*(1-{palm})*{neck},max({pinkd}*{neck},clip(({B}-{G}-6)/5,0,1)*clip(({L}-115)/12,0,1))),0,1)*{zone}*255"
skin = f"max(clip((112-{L})/10,0,1)*clip(({G}-{B}-1)/4,0,1)*gt({R},{G})*max(clip((1255-Y)/15,0,1),clip(({R}-{B}-16)/8,0,1)),clip((80-{L})/10,0,1)*clip((1255-Y)/15,0,1))*clip((Y-{FACE_Y})/10,0,1)*255"   # definite skin: dark and warm
desk = f"clip(({R}-{B}-35)/15,0,1)*clip(({L}-100)/14,0,1)*gt({R},{G})*gt({G},{B})*clip((Y-1245)/20,0,1)*255"
M = f'max(max({R},{G}),{B})'; m = f'min(min({R},{G}),{B})'
gear = f"clip((0.2-({M}-{m})/max({M},1))/0.05,0,1)*clip(({L}-90)/20,0,1)*clip((Y-1250)/20,0,1)*255"   # beige mouse/keyboard -> graphite
skind = f"clip((115-{L})/10,0,1)*clip(({R}-{B}-16)/8,0,1)*gt({R},{G})*clip((1335-Y)/12,0,1)*255"   # the hand on the mouse, protected from the desk recolour
nv = f'clip(9+0.2*({L}-110),4,60)'
print(f"""[0:v]format=rgb24,split=3[p0][p3][p8s];[p8s]gblur=sigma=1.6,split=5[p1][p2][p5][p7][p9];
[p9]geq=r='{skind}':g=0:b=0,format=gbrp,extractplanes=r,dilation,dilation,dilation,dilation,dilation,dilation,gblur=sigma=2[mk4];
[p7]geq=r='{gear}':g=0:b=0,format=gbrp,extractplanes=r,gblur=sigma=1.5[mg0];[mk2]dilation,dilation,dilation,dilation,dilation,dilation,gblur=sigma=2[mk3];[mg0][mk3]blend=all_expr='A*(255-B)/255'[mg];
[p3]split[p3a][p3b];[p3b]format=rgb24,geq=r='0.22*{L}+8':g='0.22*{L}+8':b='0.22*{L}+10',format=gbrp[gr];
[p5]geq=r='{skin}':g=0:b=0,format=gbrp,extractplanes=r,dilation,dilation,dilation,dilation,dilation,dilation,dilation,dilation,erosion,erosion,erosion,erosion,erosion,erosion,dilation,dilation,gblur=sigma=1.6,split[mk][mk2];
[p1]geq=r='{shirt}':g=0:b=0,format=gbrp,extractplanes=r,dilation,dilation,dilation,dilation,erosion,erosion,erosion,erosion,dilation,dilation,gblur=sigma=1.4[ms0];
[ms0][mk]blend=all_expr='A*(255-B)/255'[ms];
[p2]geq=r='{desk}':g=0:b=0,format=gbrp,extractplanes=r,dilation,dilation,dilation,dilation,dilation,dilation,dilation,gblur=sigma=2.5[md0];[md0][mk4]blend=all_expr='A*(255-B)/255'[md];
[p3a]gblur=sigma=6,geq=r='{nv}':g='{nv}':b='{nv}*1.05',format=gbrp,split[blk][p4];
[p4]format=rgb24,geq=r='0.05*{R}+0.11*{L}+12':g='0.05*{G}+0.11*{L}+12':b='0.05*{B}+0.11*{L}+14',format=gbrp[dk];
[p0]format=gbrp[base];
[dk]nullsink;[md]nullsink;[gr]nullsink;[mg]nullsink;[base]copy[d1];
[d1][blk][ms]maskedmerge,format=rgb24[graded]""")

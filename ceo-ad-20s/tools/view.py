"""The #view camera move from scene2.js, as per-frame numbers for the ffmpeg composite of the CEO plate.
Prints ffmpeg expressions (piecewise in t) for the person's scale factor and top-left position at OUTPUT size (K = 2 for 4K)."""
import sys
K = float(sys.argv[1]) if len(sys.argv) > 1 else 2.0
FPS = 30
def swoop(p): return 16 * p ** 5 if p < 0.5 else 1 - (-2 * p + 2) ** 5 / 2
def view(t):
    s, y = 1.0, 0.0
    if t < 2.0: return 1 + 0.04 * t / 2, 0.0
    if t < 2.9: p = swoop((t - 2.0) / 0.9); return 1.04 + (1.2 - 1.04) * p, -230 * p
    if t < 3.0: return 1.2, -230.0
    if t < 3.5: p = swoop((t - 3.0) / 0.5); return 1.2 + (1.02 - 1.2) * p, -230 + 230 * p
    if t < 5.0: return 1.02 + 0.04 * (t - 3.5) / 1.5, 0.0
    if t < 17.0: return 1.06, 0.0
    if t < 18.0: return 1.06 + 0.04 * (t - 17.0), 0.0
    return 1.1, 0.0
# person plate placement inside #view: translate(75.6,167) scale(.86); #view origin (540,960)
rows = []
for n in range(20 * FPS):
    t = n / FPS; S, Ty = view(t)
    sc = 0.86 * S
    x = 540 + (75.6 - 540) * S; y = 960 + (167 - 960) * S + Ty
    rows.append((n, sc * K, x * K, y * K))
open('out/view.txt', 'w').write('\n'.join(f'{n} {a:.5f} {b:.2f} {c:.2f}' for n, a, b, c in rows))
print(len(rows))

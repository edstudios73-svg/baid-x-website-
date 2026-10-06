"""Original score for the BAID X CEO ad (20 s). 120 BPM, beat 0.5 s, downbeats at 1, 3, 5 ... s; impact at 11.0 s.
Tension (0-3) -> search groove (3-9) -> drop (9-11) -> impact + energetic beat (11-18) -> end hit (18) -> ring out.
Pure Python (no numpy): writes mono stems; mix.sh adds space, width and the master."""
import math, random, struct, wave, array, os
SR = 44100; DUR = 20.0; N = int(DUR * SR); BEAT = 0.5
OUT = os.path.dirname(os.path.abspath(__file__))
def buf(): return array.array('f', bytes(4 * N))
def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def add(dst, src, at, g=1.0):
    i0 = int(at * SR)
    for k in range(len(src)):
        j = i0 + k
        if j >= N: break
        if j >= 0: dst[j] += src[k] * g
def write(name, b, peak):
    m = max(1e-9, max(abs(x) for x in b)); g = peak / m
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(array.array('h', (int(max(-1, min(1, x * g)) * 32767) for x in b)).tobytes())
def noise(n, seed): r = random.Random(seed); return [r.uniform(-1, 1) for _ in range(n)]
def seg(a, b, x, lo, hi): return lo + (hi - lo) * max(0, min(1, (x - a) / (b - a)))
# harmony: A minor tension, then Am F C G after the impact (one chord per bar of 2 s, bars start at odd seconds)
PRE = ([57, 60, 64], 33)
POST = [([57, 60, 64], 33), ([53, 57, 60], 29), ([55, 60, 64], 36), ([55, 59, 62], 31)]
def chord(t):
    if t < 11: return PRE
    return POST[int((t - 11) // 2) % 4]

# pad: detuned saws, low-passed; dark before the impact, open after
pad = buf(); ph = [0.0] * 6; l1 = l2 = 0.0
def cut(t):
    if t < 3: return seg(0, 3, t, 300, 700)
    if t < 8.6: return seg(3, 8.6, t, 700, 1800)
    if t < 11: return seg(8.6, 9.4, t, 1800, 260)
    return seg(11, 18, t, 2600, 5200)
def pg(t):
    if t < 0.4: return t / 0.4 * 0.5
    if 9.4 <= t < 11: return 0.35
    if t >= 18: return seg(18, 20, t, 1.0, 0)
    return 0.6 if t < 11 else 0.9
for i in range(N):
    t = i / SR; notes, _ = chord(t); s = 0.0
    for v in range(6):
        f = mtof(notes[v // 2]) * (1.004 if v % 2 else 0.996); ph[v] = (ph[v] + f / SR) % 1.0; s += 2 * ph[v] - 1
    a = 1 - math.exp(-2 * math.pi * cut(t) / SR); l1 += a * (s - l1); l2 += a * (l1 - l2)
    pad[i] = l2 * pg(t) * 0.15
    if 10.86 <= t < 11.0: pad[i] *= max(0, (11.0 - t) / 0.14) * 0.2     # the breath before the hit

# bass: 8th pulse in the search, driving 8ths with ducking after the impact
bass = buf(); bp = 0.0
for i in range(N):
    t = i / SR; _, root = chord(t); bp += mtof(root + 12) / SR
    on = (3 <= t < 8.8) or (11 <= t < 18.0)
    if not on: continue
    u = ((t - 1) % 0.25) / 0.25; env = math.exp(-u * 3.4) * min(1, u * 60)
    duck = min(1, ((t - 1) % BEAT) / 0.12) ** 2
    x = math.sin(2 * math.pi * bp) + 0.4 * math.sin(4 * math.pi * bp)
    bass[i] = math.tanh(1.7 * x) * env * (0.45 + 0.55 * duck) * (0.7 if t < 11 else 1.0)

# arp: 16th plucks (search: sparse and tense; after impact: bright)
arp = buf(); cache = {}
def pluck(m):
    if m in cache: return cache[m]
    f = mtof(m); n = int(0.2 * SR); o = array.array('f', bytes(4 * n))
    for k in range(n):
        tt = k / SR; o[k] = math.exp(-tt * 18) * min(1, tt / 0.002) * (math.sin(2 * math.pi * f * tt) + 0.25 * math.sin(6 * math.pi * f * tt) * math.exp(-tt * 40))
    cache[m] = o; return o
t = 3.0
while t < 18.0 - 1e-6:
    if not (8.8 <= t < 11.0):
        notes, _ = chord(t); k = int(round((t - 1) / 0.125))
        seq = [notes[0] + 12, notes[2] + 12, notes[1] + 12, notes[2] + 24] if t >= 11 else [notes[0] + 12, notes[0] + 24, notes[1] + 12, notes[0] + 24]
        g = (0.18 if t < 11 else 0.32) * (0.7 if k % 2 else 1)
        if t < 11 and k % 4 == 3: g = 0
        add(arp, pluck(seq[k % 4]), t, g)
    t += 0.125

# drums
def kick():
    n = int(0.35 * SR); o = array.array('f', bytes(4 * n)); p = 0.0
    for k in range(n):
        tt = k / SR; p += (48 + 115 * math.exp(-tt * 34)) / SR; o[k] = math.tanh(1.8 * math.sin(2 * math.pi * p)) * math.exp(-tt * 7.5)
    return o
def hat(seed, open_=False):
    n = int((0.15 if open_ else 0.04) * SR); x = noise(n, seed); o = array.array('f', bytes(4 * n)); pv = 0.0
    for k in range(n): hp = x[k] - pv; pv = x[k]; o[k] = hp * math.exp(-k / SR * (16 if open_ else 85)) * 0.5
    return o
def clap(seed):
    n = int(0.3 * SR); x = noise(n, seed); o = array.array('f', bytes(4 * n)); l = 0.0
    for k in range(n):
        tt = k / SR; l += 0.3 * (x[k] - l); bpf = x[k] - l
        burst = sum(math.exp(-(tt - d) * 70) for d in (0, 0.011, 0.022) if tt >= d)
        o[k] = bpf * (0.5 * burst + 0.8 * math.exp(-tt * 14))
    return o
K = kick(); drm = buf()
for b in range(int(20 / BEAT)):
    t = 1 + b * BEAT - 1.0 if False else b * BEAT
    beat = int(round((t - 1) / BEAT)) % 4
    if t < 3:                                   # tension: a soft tick every beat
        add(drm, hat(b), t, 0.10 + 0.05 * t / 3)
    elif t < 8.8:                               # search groove
        if beat in (0, 2): add(drm, K, t, 0.6)
        for s in range(4): add(drm, hat(100 + b * 4 + s), t + s * 0.125, 0.12 + 0.05 * (s % 2 == 0))
        if beat in (1, 3) and t >= 5: add(drm, clap(b), t, 0.35)
    elif 11 <= t < 18:                          # after the impact
        add(drm, K, t, 1.0)
        if beat in (1, 3): add(drm, clap(b), t, 0.75)
        add(drm, hat(300 + b), t + 0.25, 0.32)
        for s in (1, 3): add(drm, hat(400 + b * 4 + s), t + s * 0.125, 0.14)
add(drm, hat(7, True), 11.0, 0.9); add(drm, hat(8, True), 15.0, 0.6)

# impacts, risers, the end
fx = buf()
def boom(dur, f0, f1, g, nz=0.35):
    n = int(dur * SR); o = array.array('f', bytes(4 * n)); p = 0.0; x = noise(n, 9); l = 0.0
    for k in range(n):
        tt = k / SR; f = f1 + (f0 - f1) * math.exp(-tt * 3); p += f / SR; l += 0.02 * (x[k] - l)
        o[k] = (math.tanh(2.2 * math.sin(2 * math.pi * p)) * math.exp(-tt * 1.5) + l * nz * 8 * math.exp(-tt * 6)) * g
    return o
def riser(a, b, g, seed=11):
    n = int((b - a) * SR); x = noise(n, seed); l = 0.0
    for k in range(n):
        p = k / n; c = 0.01 + 0.5 * p * p; l += c * (x[k] - l); j = int(a * SR) + k
        if j < N: fx[j] += l * p * p * g
riser(9.6, 10.86, 0.9)
add(fx, boom(3.0, 95, 30, 1.0), 11.0)
add(fx, boom(1.0, 80, 40, 0.35, 0.2), 5.0)
riser(16.9, 18.0, 0.6, 12)
add(fx, boom(2.2, 90, 32, 0.85), 18.0)
for i in range(int(19.2 * SR), N): fx[i] *= max(0, (20.0 - i / SR) / 0.8)

for name, b, pk in (('pad.wav', pad, 0.7), ('bass.wav', bass, 0.8), ('arp.wav', arp, 0.6), ('drums.wav', drm, 0.9), ('fx.wav', fx, 0.9)):
    write(name, b, pk); print('wrote', name)

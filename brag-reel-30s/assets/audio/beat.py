"""Original beat for the BAID X site ad — melodic hip-hop / drill feel, 144 BPM, 18 bars = 30.0 s.
Pure Python (no numpy available): writes mono stems; ffmpeg does reverb, stereo and the master."""
import math, random, struct, wave, array, sys, os
SR = 44100; BPM = 144; BEAT = 60 / BPM; BAR = 4 * BEAT; BARS = 18; N = int(round(BARS * BAR * SR))
OUT = os.path.dirname(os.path.abspath(__file__)); rnd = random.Random(7)
def buf(): return array.array('f', bytes(4 * N))
def mtof(m): return 440.0 * 2 ** ((m - 69) / 12)
def add(dst, src, at, gain=1.0):
    i0 = int(at * SR)
    for k, v in enumerate(src):
        j = i0 + k
        if j >= N: break
        if j >= 0: dst[j] += v * gain
def write(name, b, peak=0.9):
    m = max(1e-9, max(abs(x) for x in b)); g = peak / m
    with wave.open(os.path.join(OUT, name), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', int(max(-1, min(1, x * g)) * 32767)) for x in b))
cache = {}
def piano(m, dur):              # soft electric-piano: additive partials, fast attack, exp decay
    key = ('p', m, round(dur, 3))
    if key in cache: return cache[key]
    f = mtof(m); n = int((dur + 0.6) * SR); out = array.array('f', bytes(4 * n))
    parts = [(1, 1.0, 2.2), (2, 0.42, 3.4), (3, 0.16, 5.0), (4, 0.07, 6.5), (1.003, 0.35, 2.0)]
    for i in range(n):
        t = i / SR; a = min(1, t / 0.006); rel = 1.0 if t < dur else math.exp(-(t - dur) * 9)
        s = 0.0
        for h, amp, dec in parts: s += amp * math.exp(-t * dec) * math.sin(2 * math.pi * f * h * t)
        out[i] = s * a * rel
    cache[key] = out; return out
def bell(m):                    # pluck for the top-line arpeggio
    key = ('b', m)
    if key in cache: return cache[key]
    f = mtof(m); n = int(0.5 * SR); out = array.array('f', bytes(4 * n))
    for i in range(n):
        t = i / SR; e = math.exp(-t * 9) * min(1, t / 0.003)
        out[i] = e * (math.sin(2 * math.pi * f * t) + 0.3 * math.sin(2 * math.pi * f * 3.01 * t) * math.exp(-t * 20))
    cache[key] = out; return out
def b808(m, dur, glide_to=None): # 808 with pitch drop on attack, optional slide, soft saturation
    f0 = mtof(m); f1 = mtof(glide_to) if glide_to is not None else f0
    n = int((dur + 0.25) * SR); out = array.array('f', bytes(4 * n)); ph = 0.0
    for i in range(n):
        t = i / SR
        f = f0 * (1 + 1.6 * math.exp(-t * 38))
        if glide_to is not None and t > dur * 0.55: f = f0 + (f1 - f0) * min(1, (t - dur * 0.55) / (dur * 0.3))
        ph += 2 * math.pi * f / SR
        env = min(1, t / 0.002) * (1.0 if t < dur else math.exp(-(t - dur) * 14)) * (0.75 + 0.25 * math.exp(-t * 3))
        out[i] = math.tanh(1.4 * math.sin(ph)) / math.tanh(1.4) * env
    return out
def noise(n, seed):
    r = random.Random(seed); return [r.uniform(-1, 1) for _ in range(n)]
def hat(open_=False, seed=1):
    n = int((0.14 if open_ else 0.045) * SR); x = noise(n, seed); out = array.array('f', bytes(4 * n)); prev = 0.0
    for i in range(n):
        hp = x[i] - prev; prev = x[i]          # crude high-pass
        out[i] = hp * math.exp(-i / SR * (18 if open_ else 70)) * 0.5
    return out
def clap(seed=3):
    n = int(0.32 * SR); x = noise(n, seed); out = array.array('f', bytes(4 * n)); lp = 0.0
    for i in range(n):
        t = i / SR; lp += 0.35 * (x[i] - lp); bp = x[i] - lp
        bursts = sum(math.exp(-max(0, t - d) * 60) for d in (0, 0.012, 0.024) if t >= d)
        out[i] = bp * (0.55 * bursts + 0.9 * math.exp(-t * 16)) + 0.35 * math.sin(2 * math.pi * 190 * t) * math.exp(-t * 30)
    return out
def kick():
    n = int(0.12 * SR); out = array.array('f', bytes(4 * n))
    for i in range(n):
        t = i / SR; out[i] = math.sin(2 * math.pi * (60 + 140 * math.exp(-t * 60)) * t) * math.exp(-t * 28)
    return out

# harmony: Am – F – C – G (motivational minor), one chord per bar
CH = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]
ROOT = [33, 29, 36, 31]                    # 808 roots (A1, F1, C2, G1)
ARP = [[81, 76, 72, 76], [77, 72, 69, 72], [79, 76, 72, 76], [79, 74, 71, 74]]
pno, top, sub, drm, fx = buf(), buf(), buf(), buf(), buf()
DROP, BREAK_AT, OUTRO = 2, (8, 0.5), 17     # bar indices (0-based): drop at bar 2 (3.33 s), break in 2nd half of bar 8, last bar ring-out
for b in range(BARS):
    t0 = b * BAR; c = b % 4
    for k, m in enumerate(CH[c]): add(pno, piano(m, BAR * 0.96), t0 + k * 0.012, 0.32)
    if b >= DROP and b < OUTRO:
        for s in range(8):                   # 8th-note arpeggio
            add(top, bell(ARP[c][s % 4]), t0 + s * BEAT / 2, 0.22 if s % 2 == 0 else 0.15)
    in_break = (b == BREAK_AT[0])
    if DROP <= b < OUTRO:
        # 808: downbeat, plus syncopated hits with a slide every other bar
        add(sub, b808(ROOT[c], BEAT * 1.4), t0, 0.9)
        if not in_break:
            add(sub, b808(ROOT[c], BEAT * 0.6), t0 + 2.5 * BEAT, 0.75)
            add(sub, b808(ROOT[c] + 12 if b % 2 else ROOT[c], BEAT * 0.9, ROOT[(c + 1) % 4] if b % 2 else None), t0 + 3.25 * BEAT, 0.7)
        add(drm, kick(), t0, 0.55)
        # clap on beat 3 (half-time)
        if not (in_break and True): add(drm, clap(b), t0 + 2 * BEAT, 0.8)
        # hats: 8ths, with a triplet-16th roll at the end of every 2nd bar
        for s in range(8):
            tt = t0 + s * BEAT / 2
            if in_break and s >= 4: break
            if b % 2 == 1 and s == 7:
                for r in range(6): add(drm, hat(seed=100 + b * 10 + r), tt + r * BEAT / 6, 0.35 + 0.05 * r)
            elif b % 4 == 3 and s == 5:
                add(drm, hat(True, seed=50 + b), tt, 0.45)
            else:
                add(drm, hat(seed=b * 16 + s), tt, 0.42 if s % 2 == 0 else 0.3)
    if b == OUTRO:                            # final ring: long 808 + chord
        add(sub, b808(ROOT[c], BAR * 0.95), t0, 0.55)
        add(drm, clap(99), t0, 0.5)
# risers: into the drop (bars 0–1) and out of the break (2nd half of bar 8)
def riser(start, dur, gain):
    n = int(dur * SR); x = noise(n, 11); lp = 0.0
    for i in range(n):
        p = i / n; a = 0.02 + 0.6 * p * p; lp += a * (x[i] - lp)
        j = int(start * SR) + i
        if j < N: fx[j] += lp * p * p * gain
riser(0.0, 2 * BAR, 0.6)
riser(BREAK_AT[0] * BAR + BAR / 2, BAR / 2, 0.5)
# intro filter: piano low-passed during bars 0–1, opening up into the drop
lp = 0.0
for i in range(int(2 * BAR * SR)):
    p = i / (2 * BAR * SR); a = 0.03 + 0.5 * p ** 2; lp += a * (pno[i] - lp); pno[i] = lp * (0.6 + 0.4 * p)
for name, b, pk in (('piano.wav', pno, 0.8), ('top.wav', top, 0.6), ('808.wav', sub, 0.9), ('drums.wav', drm, 0.9), ('fx.wav', fx, 0.5)):
    write(name, b, pk); print('wrote', name)

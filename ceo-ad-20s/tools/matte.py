"""Clean up the person matte, frame by frame (pure Python, no numpy).
stdin: raw 8-bit gray frames (W x H) of the rough key (255 = person/desk, 0 = wall).
stdout: raw 8-bit gray frames: solid silhouette (holes filled, wall specks removed), same size.
Steps: close small gaps -> flood the wall from the top/side edges -> keep only what touches the bottom edge (desk) -> fill holes."""
import sys, array
W, H = int(sys.argv[1]), int(sys.argv[2]); R = int(sys.argv[3]) if len(sys.argv) > 3 else 2
HEAD = open(sys.argv[4], 'w') if len(sys.argv) > 4 else None   # per-frame head-top row (full-res px), for face protection
n = W * H; inp = sys.stdin.buffer; out = sys.stdout.buffer
def dilate(m, r):
    o = bytearray(m)
    for _ in range(r):
        p = bytearray(o)
        for y in range(H):
            row = y * W
            for x in range(W):
                if p[row + x]: continue
                if (x > 0 and p[row + x - 1]) or (x < W - 1 and p[row + x + 1]) or (y > 0 and p[row - W + x]) or (y < H - 1 and p[row + W + x]): o[row + x] = 1
    return o
def erode(m, r):
    inv = bytearray(1 - v for v in m); inv = dilate(inv, r); return bytearray(1 - v for v in inv)
def flood(free, seeds):
    seen = bytearray(n); st = [s for s in seeds if free[s]]
    for s in st: seen[s] = 1
    while st:
        i = st.pop(); x = i % W
        for j in ((i - 1) if x > 0 else -1, (i + 1) if x < W - 1 else -1, i - W, i + W):
            if 0 <= j < n and free[j] and not seen[j]: seen[j] = 1; st.append(j)
    return seen
while True:
    b = inp.read(n)
    if len(b) < n: break
    o = bytearray(1 if v > 127 else 0 for v in b)
    c = erode(dilate(o, R), R)                       # closing: seal hairline gaps
    free = bytearray(1 - v for v in c)
    seeds = list(range(W)) + [y * W for y in range(H)] + [y * W + W - 1 for y in range(H)]
    wall = flood(free, seeds)
    keep = bytearray(1 - v for v in wall)            # person + desk + holes filled
    body = flood(keep, [(H - 1) * W + x for x in range(W)])  # only what is connected to the desk
    out.write(bytes(255 if v else 0 for v in body))
    if HEAD:
        x0, x1 = int(W * 0.25), int(W * 0.75); top = H
        for y in range(H):
            if any(body[y * W + x] for x in range(x0, x1)): top = y; break
        xs = [x for y in range(top, min(H, top + H // 24)) for x in range(x0, x1) if body[y * W + x]]
        cx = sum(xs) / len(xs) if xs else W / 2
        HEAD.write(f"{top * 1920 / H:.1f} {cx * 1080 / W:.1f}\n")
out.flush()
if HEAD: HEAD.close()

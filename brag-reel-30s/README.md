# BAID X — 30 s site reel (Reels / TikTok)

A concept-ad in the style of the client's inDrive 2.0 reference (dark stage, one brand-colour light, 3D phone, push into the app, UI showcase, three kinetic lines, logo lock-up) — about BAID X, built from this website's own facts and assets.

| Path | What |
|---|---|
| `out/baidx-site-reel-30s.mp4` | **Final** — 1080×1920, 60 fps, H.264 + AAC, 30.0 s |
| `out/baidx-site-reel-cover.jpg` | cover still for the post |
| `reel-a.html` / `reel-b.html` | the two 15 s shots (open in a browser to preview) |
| `reel.css` | shared look: site tokens (#050505, cards #0e0e0e, line #2c2c2c), Inter, black-and-white theme (white is the only accent), the real logo |
| `assets/` | site logo + mark (`baidx_mark.png`), Inter woff2, app screenshots, the music |
| `assets/audio/beat.py` | **original** 144 BPM beat (synthesised from code — no third-party samples), stems mixed with ffmpeg → `beat-30s.wav` |
| `motion.js`, `motion.css`, `sfx.js` | animation engine (apple-style-motion skill) |

## Story (144 BPM · beat 0.417 s · bar 1.667 s)
| Time | Beat | On screen (all copy from `llms-full.txt`, `index.html`, `assets/og-image.png`, the app) |
|---|---|---|
| 0–3.3 | filtered intro + riser | phone turns out of the dark, white light |
| 3.3 | **drop** | phone snaps to camera; island: BAID X · Your profile is verified |
| 4–6.7 | | home screen → tap the BAID X app → push through the icon → white wipe on the bar |
| 6.7–11.2 | roles every 2 beats | WHO IT'S FOR — Workers / Companies / Project managers / Suppliers / Clients with each role's "What you get" items |
| 11.2–13.3 | | 50 trades · 16 regions — "Every trade. Every region." over live trade marquees |
| 13.3–15 | break | Verified card + four badge tiers — "Verified with Ghana Card. Never for sale." |
| 15–16.7 | | end-to-end encrypted chat (text, voice note) |
| 16.7–18.3 | | search "Electrician in Kumasi" → white action button |
| 18.3–25 | one line per bar | The future of work isn't about connections. / It's about capability. / Verified people. Real projects. / All 16 regions. One trusted network. |
| 25–30 | outro | mark pops + pulses → BAID X™ logo → GHANA'S WORK NETWORK → **Join free at baidx.com** → Built and powered by Baiden Creatives |

Illustrative UI content (the chat lines, "Kwame Mensah") follows the app's own demo data; no statistics, prices or reviews are claimed.

## Rebuild
```bash
R=<blackboy-store>/.claude/skills/apple-style-motion/scripts/render.mjs   # or any copy of the skill
node $R reel-a.html --out out/reel-a.mp4 && node $R reel-b.html --out out/reel-b.mp4
printf "file 'reel-a.mp4'\nfile 'reel-b.mp4'\n" > out/list.txt && ffmpeg -f concat -safe 0 -i out/list.txt -c copy out/ab.mp4
ffmpeg -i out/ab.mp4 -i assets/audio/beat-30s.wav -filter_complex "[0:a]volume=0.45[s];[1:a][s]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.89[a]" \
  -map 0:v -map "[a]" -c:v libx264 -crf 19 -preset slow -pix_fmt yuv420p -c:a aac -b:a 256k -movflags +faststart out/baidx-site-reel-30s.mp4
python3 assets/audio/beat.py   # regenerate the beat stems (then re-mix, see the ffmpeg chain in the commit notes)
```

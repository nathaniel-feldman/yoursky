#!/usr/bin/env python3
"""Generate the favicon, home-screen icon and link-preview image as SVG, then rasterize with macOS sips.

Usage: python3 scripts/make_assets.py
"""
import math, os, random, shutil, subprocess, tempfile

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app", "public")
GA = math.pi * (3 - math.sqrt(5))


def planet(cx, cy, r, n, seed, light=(-0.55, -0.6, 0.58), dot=1.0, ring=True):
    rnd = random.Random(seed)
    lx, ly, lz = light
    ln = math.sqrt(lx * lx + ly * ly + lz * lz); lx, ly, lz = lx / ln, ly / ln, lz / ln
    out = []
    for i in range(n):
        rr = min(0.995, math.sqrt((i + 0.5) / n) + (rnd.random() - 0.5) * 0.03)
        th = i * GA + (rnd.random() - 0.5) * 0.3
        x, y = math.cos(th) * rr, math.sin(th) * rr
        z = math.sqrt(max(0, 1 - x * x - y * y))
        b = 0.1 + max(0, x * lx + y * ly + z * lz) * 0.75 + (1 - z) ** 2 * 0.15
        b *= 0.8 + 0.2 * math.sin(math.asin(y) * 6 + math.sin(math.atan2(z, x) * 3) * 0.6)
        v = int(40 + min(1, b) * 215)
        out.append(f'<rect x="{cx + x * r:.1f}" y="{cy + y * r:.1f}" width="{dot:.2f}" height="{dot:.2f}" fill="rgb({v},{v + 3},{min(255, v + 9)})"/>')
    if ring:
        for i in range(int(n * 0.35)):
            a = rnd.random() * 2 * math.pi
            g = (rnd.random() + rnd.random() + rnd.random()) / 3
            rr2 = r * (1.45 + g * 0.7)
            x, y = math.cos(a) * rr2, math.sin(a) * rr2 * 0.28
            if y < 0 and abs(x) < r * 0.95:  # behind the planet
                continue
            v = int(150 + rnd.random() * 90)
            out.append(f'<rect x="{cx + x:.1f}" y="{cy + y:.1f}" width="{dot * 0.9:.2f}" height="{dot * 0.9:.2f}" fill="rgb({v},{v + 4},{min(255, v + 14)})"/>')
    return "".join(out)


def stars(w, h, n, seed):
    rnd = random.Random(seed)
    return "".join(f'<rect x="{rnd.random() * w:.0f}" y="{rnd.random() * h:.0f}" width="1.6" height="1.6" fill="#fff" opacity="{0.15 + rnd.random() * 0.5:.2f}"/>' for _ in range(n))


def icon_svg(size):
    s = size
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{s}" height="{s}" viewBox="0 0 {s} {s}">
<defs><radialGradient id="g" cx="50%" cy="0%" r="110%"><stop offset="0" stop-color="#2e3137"/><stop offset="0.5" stop-color="#17191c"/><stop offset="1" stop-color="#0b0c0e"/></radialGradient></defs>
<rect width="{s}" height="{s}" rx="{s * 0.22:.0f}" fill="url(#g)"/>
{planet(s / 2, s / 2, s * 0.24, int(s * 4.5), 7, dot=max(1.2, s / 110))}
</svg>'''


def og_svg():
    w, h = 1200, 630
    return f'''<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}">
<defs>
<radialGradient id="g" cx="30%" cy="-10%" r="120%"><stop offset="0" stop-color="#2e3137"/><stop offset="0.45" stop-color="#17191c"/><stop offset="1" stop-color="#0b0c0e"/></radialGradient>
<linearGradient id="m" x1="0" x2="1"><stop offset="0" stop-color="#a3a8b0"/><stop offset="0.3" stop-color="#f7f8fa"/><stop offset="0.55" stop-color="#b9bec6"/><stop offset="0.75" stop-color="#ffffff"/><stop offset="1" stop-color="#9aa0a8"/></linearGradient>
</defs>
<rect width="{w}" height="{h}" fill="url(#g)"/>
{stars(w, h, 140, 3)}
<g fill="none" stroke="#dce1eb" stroke-opacity="0.08" stroke-width="2">
<ellipse cx="985" cy="330" rx="130" ry="62"/><ellipse cx="985" cy="330" rx="195" ry="92"/><ellipse cx="985" cy="330" rx="250" ry="118"/>
</g>
{planet(985, 330, 76, 2300, 11, dot=2.1)}
{planet(860, 236, 15, 200, 21, dot=1.6, ring=False)}
{planet(1160, 372, 20, 260, 31, dot=1.6, ring=False)}
{planet(1040, 440, 13, 150, 41, dot=1.5, ring=False)}
{planet(880, 420, 11, 120, 51, dot=1.4, ring=False)}
<text x="80" y="140" font-family="Menlo, monospace" font-size="22" letter-spacing="7" fill="#9aa0a8">YOUR SKY</text>
<text x="76" y="290" font-family="Georgia, 'Times New Roman', serif" font-size="84" fill="url(#m)">You are the sun.</text>
<text x="76" y="380" font-family="Georgia, 'Times New Roman', serif" font-style="italic" font-size="70" fill="url(#m)">Colleges are planets.</text>
<text x="80" y="470" font-family="Helvetica, Arial, sans-serif" font-size="28" fill="#b8bcc4">The better a school fits you, the closer it orbits.</text>
<text x="80" y="560" font-family="Menlo, monospace" font-size="24" fill="#8e939c">findyoursky.com</text>
</svg>'''


def rasterize(svg, out_name, fmt="png"):
    # sips renders an SVG at its own pixel size, so each SVG is authored at its final dimensions.
    tmp = tempfile.mkdtemp()
    path = os.path.join(tmp, "a.svg")
    open(path, "w").write(svg)
    args = ["sips", "-s", "format", fmt] + (["-s", "formatOptions", "84"] if fmt == "jpeg" else []) + [path, "--out", os.path.join(ROOT, out_name)]
    subprocess.run(args, check=True, capture_output=True)
    shutil.rmtree(tmp)


if __name__ == "__main__":
    open(os.path.join(ROOT, "favicon.svg"), "w").write(icon_svg(64))
    rasterize(icon_svg(180), "apple-touch-icon.png")
    rasterize(og_svg(), "og.jpg", "jpeg")
    print("Wrote favicon.svg, apple-touch-icon.png, og.jpg")

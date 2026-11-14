#!/usr/bin/env python3
"""생성한 재질 사진 → 반복해도 얼룩·이음매 없는 PBR 텍스처(알베도 + 노멀맵).
  python3 make_tex.py <사진> <이름> [--grout 칸수] [--grout-px 줄눈px] [--grout-color #RRGGBB] [--tone 0.06] [--size 1024] [--bump 2.0]
결과: template/assets/tex/<이름>.jpg · <이름>_n.jpg
1) 조명 얼룩 지우기: 크게 흐린 밝기로 나눠 그림자·밝기 기울기를 없앤다(벽에 반복하면 얼룩 무늬가 되던 원인)
2) 이음매: 반만큼 밀어 둔 사본과 가장자리 띠에서 섞는다(상하좌우가 이어진다)
3) 줄눈(--grout N): 줄눈을 그림 가장자리와 N칸 경계에 그린다 → 반복해도 줄이 정확히 맞는다. 칸마다 밝기를 조금씩 달리한다(--tone)
4) 노멀맵: 밝기를 높이로 보고 기울기를 구한다(가장자리는 반대편과 이어서 계산)
"""
import sys as _sys  # Windows 콘솔·파이프에서도 한글 출력이 깨지거나 멈추지 않게
for _st in (_sys.stdout, _sys.stderr):
    if hasattr(_st, 'reconfigure'): _st.reconfigure(encoding='utf-8', errors='replace')
import argparse, math
from pathlib import Path
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

SKILL = Path(__file__).resolve().parent.parent
OUT = SKILL / 'template' / 'assets' / 'tex'


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('src'); ap.add_argument('name')
    ap.add_argument('--size', type=int, default=1024); ap.add_argument('--grout', type=int, default=0); ap.add_argument('--grout-px', type=float, default=4)
    ap.add_argument('--grout-color', default='#BDBAB4'); ap.add_argument('--tone', type=float, default=0.0); ap.add_argument('--bump', type=float, default=2.0)
    ap.add_argument('--band', type=float, default=0.18, help='이음매 섞는 띠(그림 폭 비율)')
    a = ap.parse_args()
    im = Image.open(a.src).convert('RGB'); s = min(im.size)
    im = im.crop(((im.width - s) // 2, (im.height - s) // 2, (im.width + s) // 2, (im.height + s) // 2)).resize((a.size, a.size), Image.LANCZOS)
    x = np.asarray(im, np.float32) / 255.0; N = a.size
    # 1) 조명 얼룩 지우기
    lum = x @ np.array([0.299, 0.587, 0.114], np.float32)
    low = ndi.gaussian_filter(lum, N / 12, mode='wrap')
    x = np.clip(x * (lum.mean() / np.maximum(low, 1e-3))[..., None], 0, 1)
    # 2) 이음매: 반 밀린 사본과 가장자리 띠에서 섞기
    r = np.roll(x, (N // 2, N // 2), (0, 1))
    t = np.linspace(0, 1, N); d = np.minimum(t, 1 - t)  # 가장자리까지 거리(0~0.5)
    w1 = np.clip(d / a.band, 0, 1); w1 = w1 * w1 * (3 - 2 * w1)
    w = np.minimum(w1[:, None], w1[None, :])[..., None]  # 가운데 1(원본), 가장자리 0(밀린 사본 = 원본 가운데)
    x = x * w + r * (1 - w)
    # 3) 줄눈과 칸별 밝기
    if a.grout:
        n = a.grout; cell = N / n; rng = np.random.default_rng(5)
        tone = 1 + (rng.random((n, n)) - 0.5) * 2 * a.tone
        yy, xx = np.mgrid[0:N, 0:N]
        x = x * tone[(yy // cell).astype(int).clip(0, n - 1), (xx // cell).astype(int).clip(0, n - 1)][..., None]
        gc = np.array([int(a.grout_color[i:i + 2], 16) / 255 for i in (1, 3, 5)], np.float32)
        fx = np.minimum(xx % cell, cell - xx % cell); fy = np.minimum(yy % cell, cell - yy % cell)
        g = np.clip((a.grout_px / 2 + 0.5 - np.minimum(fx, fy)), 0, 1)[..., None]  # 줄눈 안 1, 가장자리 반 픽셀 부드럽게
        x = x * (1 - g) + gc * g
        groove = np.clip(1 - np.minimum(fx, fy) / (a.grout_px * 1.5), 0, 1)  # 줄눈은 오목하게
    else:
        groove = 0
    x = np.clip(x, 0, 1)
    # 4) 노멀맵(높이 = 잔 밝기 변화 - 줄눈 홈)
    h = x @ np.array([0.299, 0.587, 0.114], np.float32)
    h = h - ndi.gaussian_filter(h, 8, mode='wrap') - 0.25 * groove
    h = ndi.gaussian_filter(h, 0.8, mode='wrap')
    gx = ndi.sobel(h, 1, mode='wrap'); gy = ndi.sobel(h, 0, mode='wrap')
    nx, ny, nz = -gx * a.bump, gy * a.bump, np.ones_like(h)
    L = np.sqrt(nx ** 2 + ny ** 2 + nz ** 2); nm = np.stack([nx / L, ny / L, nz / L], -1) * 0.5 + 0.5
    OUT.mkdir(parents=True, exist_ok=True)
    Image.fromarray((x * 255).astype(np.uint8)).save(OUT / f'{a.name}.jpg', quality=88)
    Image.fromarray((nm * 255).astype(np.uint8)).save(OUT / f'{a.name}_n.jpg', quality=90)
    print(f'{a.name}: {OUT / (a.name + ".jpg")} · 노멀맵 {OUT / (a.name + "_n.jpg")}')


if __name__ == '__main__':
    main()

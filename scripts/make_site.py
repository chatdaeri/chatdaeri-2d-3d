#!/usr/bin/env python3
"""scene.json + 평면도 → 정적 3D 투어 웹사이트 폴더.
  python3 make_site.py <작업폴더> <출력폴더> [--port 4400]
출력 폴더는 그대로 어느 정적 호스팅에 올려도 된다(서버 코드 없음). 이 컴퓨터에서 보려면 출력 폴더의 `열기.command`(Mac)·`열기.bat`(Windows)를 두 번 누른다.
"""
import sys as _sys  # Windows 콘솔·파이프에서도 한글 출력이 깨지거나 멈추지 않게
for _st in (_sys.stdout, _sys.stderr):
    if hasattr(_st, 'reconfigure'): _st.reconfigure(encoding='utf-8', errors='replace')
import argparse, json, shutil, stat
from pathlib import Path
from PIL import Image

SKILL = Path(__file__).resolve().parent.parent
TEMPLATE = SKILL / 'template'
# 고치기 전 백업·편집기 임시 파일. 사이트는 그대로 공개되므로 복사하지 않고, 출력 폴더에 남아 있으면 지운다.
JUNK = ('*.bak*', '*.orig', '*.old', '*.tmp', '*.swp', '*~', '.DS_Store')


def find_image(work, *cands):
    """평면도 찾기: 작업폴더 기준 상대경로 → 적힌 절대경로 → 작업폴더 안 source.* 순. 폴더를 옮기거나 다른 컴퓨터로 넘겨도 열린다."""
    for c in cands:
        if not c: continue
        p = Path(c).expanduser()
        if not p.is_absolute(): p = work / p
        if p.exists(): return p
    for p in sorted(work.glob('source.*')): return p
    raise SystemExit(f'평면도 이미지를 찾지 못함: {cands[0] or cands[-1]} → 작업폴더에 source.png 로 넣거나 plan.json "image"를 고친다')


def is_junk(name):
    from fnmatch import fnmatch
    return any(fnmatch(name, p) for p in JUNK)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('work'); ap.add_argument('out'); ap.add_argument('--port', type=int, default=4400)
    a = ap.parse_args()
    work, out = Path(a.work).resolve(), Path(a.out).resolve()
    scene = json.loads((work / 'scene.json').read_text(encoding='utf-8'))
    plan = json.loads((work / 'plan.json').read_text(encoding='utf-8'))
    out.mkdir(parents=True, exist_ok=True)
    # 템플릿 복사(엔진 코드·에셋은 덮어쓴다)
    junk_in_template = [p for p in TEMPLATE.rglob('*') if is_junk(p.name) and p.name != '.DS_Store']
    for item in TEMPLATE.iterdir():
        if is_junk(item.name): continue
        dst = out / item.name
        if item.is_dir():
            if dst.exists(): shutil.rmtree(dst)
            bare, keepGlb = scene.get('bare'), {'toilet.glb', 'vanity.glb', 'bathtub.glb'} # 구조만: 가구 3D 파일은 위생도기만 싣는다
            shutil.copytree(item, dst, ignore=lambda d, names: [n for n in names if is_junk(n) or (bare and Path(d).name == 'furniture' and n not in keepGlb)])
        else: shutil.copy2(item, dst)
    removed = [p for p in out.rglob('*') if p.is_file() and is_junk(p.name)]
    for p in removed: p.unlink()
    # 코드 파일마다 버전 표시(?v=내용 해시): 정적 서버가 캐시를 막지 않아 브라우저가 예전 코드를 계속 쓰는 일을 막는다
    import hashlib, re
    src = sorted((out / 'src').glob('*.js'))
    ver = {f.name: hashlib.md5(f.read_bytes()).hexdigest()[:8] for f in src}
    html = (out / 'index.html').read_text(encoding='utf-8')
    extra = ', '.join(f'"./src/{n}": "./src/{n}?v={h}"' for n, h in ver.items())
    html = html.replace('"three/addons/": "./vendor/three/addons/" }', f'"three/addons/": "./vendor/three/addons/", {extra} }}')
    html = re.sub(r'src="src/app\.js(\?v=[0-9a-f]+)?"', f'src="src/app.js?v={ver.get("app.js", "0")}"', html)
    (out / 'index.html').write_text(html, encoding='utf-8')
    # 창밖 배경: scene.view 사진이 템플릿에 없으면 forest
    if not (out / 'assets' / 'tex' / f"{scene.get('view', 'forest')}.jpg").exists(): scene['view'] = 'forest'
    Image.open(find_image(work, plan.get('image'))).convert('RGB').save(out / 'plan.png', optimize=True)
    (out / 'scene.json').write_text(json.dumps(scene, ensure_ascii=False), encoding='utf-8')
    cmd = out / '열기.command'
    cmd.write_text(f'''#!/bin/zsh
# 이 폴더를 http://127.0.0.1:{a.port}/ 로 열어 3D 투어를 본다(창을 닫으면 꺼진다)
cd "$(dirname "$0")"
PIDS=$(lsof -tiTCP:{a.port} -sTCP:LISTEN 2>/dev/null); [ -n "$PIDS" ] && kill $PIDS 2>/dev/null; sleep 0.3
( sleep 1; open "http://127.0.0.1:{a.port}/" ) &
if command -v python3 >/dev/null 2>&1; then exec python3 -m http.server {a.port} --bind 127.0.0.1
elif command -v npx >/dev/null 2>&1; then exec npx --yes http-server -p {a.port} -a 127.0.0.1 -c-1
else echo "Python 3 또는 Node.js가 필요합니다. https://www.python.org/downloads/ 또는 https://nodejs.org/ 에서 설치한 뒤 다시 두 번 누르세요."; read -n 1; fi
''', encoding='utf-8')
    cmd.chmod(cmd.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    # Windows: 열기.bat 두 번 누르기(Python → py → Node 순, 실제로 실행되는지로 찾는다 — python 이 스토어 안내용 빈 실행 파일일 때가 많다)
    (out / '열기.bat').write_text(f'''@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" "http://127.0.0.1:{a.port}/"
python -c "import sys" >nul 2>nul && (python -m http.server {a.port} --bind 127.0.0.1 & goto :eof)
py -3 -c "import sys" >nul 2>nul && (py -3 -m http.server {a.port} --bind 127.0.0.1 & goto :eof)
where npx >nul 2>nul && (npx --yes http-server -p {a.port} -a 127.0.0.1 -c-1 & goto :eof)
echo Python 3 또는 Node.js가 필요합니다. https://www.python.org/downloads/ 또는 https://nodejs.org/ 에서 설치한 뒤 다시 실행하세요.
pause
'''.replace('\n', '\r\n'), encoding='utf-8')
    if junk_in_template:
        print(f'경고: 템플릿 안에 백업 파일 {len(junk_in_template)}개(사이트에는 안 넣음). 스킬의 backups/ 폴더로 옮기세요: ' + ', '.join(str(p.relative_to(SKILL)) for p in junk_in_template))
    if [p for p in removed if p.name != '.DS_Store']:
        print('사이트에 남아 있던 백업 파일을 지움: ' + ', '.join(str(p.relative_to(out)) for p in removed if p.name != '.DS_Store'))
    size = sum(f.stat().st_size for f in out.rglob('*') if f.is_file()) / 1e6
    print(f'웹사이트: {out} ({size:.1f}MB)\n보기: Mac은 열기.command · Windows는 열기.bat 두 번 누르기, 또는 python3 -m http.server {a.port} --directory "{out}"')


if __name__ == '__main__':
    main()

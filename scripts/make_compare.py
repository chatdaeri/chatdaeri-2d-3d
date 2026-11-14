#!/usr/bin/env python3
"""인테리어 전후 비교 사이트: 같은 집의 '전'·'후' 작업 폴더 → 한 화면에서 막대로 나눠 보는 정적 사이트.
  python3 make_compare.py <전 작업폴더> <후 작업폴더> <출력폴더> [--port 4440]
'후' plan.json에는 "navAnd": "<전 작업폴더>/scene.json"(상대 경로)을 적어 두 장면 모두에서 걸을 수 있는 칸만 쓰게 한다.
출력: index.html(비교 화면) · before/ · after/(각각 make_site 결과) · 열기.command(Mac) · 열기.bat(Windows)
"""
import sys as _sys  # Windows 콘솔·파이프에서도 한글 출력이 깨지거나 멈추지 않게
for _st in (_sys.stdout, _sys.stderr):
    if hasattr(_st, 'reconfigure'): _st.reconfigure(encoding='utf-8', errors='replace')
import argparse, shutil, stat, subprocess, sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SKILL = HERE.parent


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('before'); ap.add_argument('after'); ap.add_argument('out'); ap.add_argument('--port', type=int, default=4440)
    a = ap.parse_args()
    out = Path(a.out).resolve(); out.mkdir(parents=True, exist_ok=True)
    for side, work in (('before', a.before), ('after', a.after)):
        r = subprocess.run([sys.executable, HERE / 'make_site.py', work, out / side], capture_output=True, text=True, encoding='utf-8', errors='replace')
        if r.returncode: sys.exit(f'{side} 사이트 만들기 실패:\n{r.stderr}')
        for n in ('열기.command', '열기.bat'): (out / side / n).unlink(missing_ok=True)
    shutil.copy2(SKILL / 'template-compare' / 'index.html', out / 'index.html')
    cmd = out / '열기.command'
    cmd.write_text(f'''#!/bin/zsh
# 전후 비교 화면을 http://127.0.0.1:{a.port}/ 로 연다(창을 닫으면 꺼진다)
cd "$(dirname "$0")"
PIDS=$(lsof -tiTCP:{a.port} -sTCP:LISTEN 2>/dev/null); [ -n "$PIDS" ] && kill $PIDS 2>/dev/null; sleep 0.3
( sleep 0.8; open "http://127.0.0.1:{a.port}/" ) &
exec python3 -m http.server {a.port} --bind 127.0.0.1
''', encoding='utf-8')
    cmd.chmod(cmd.stat().st_mode | stat.S_IXUSR | stat.S_IXGRP | stat.S_IXOTH)
    (out / '열기.bat').write_text(f'''@echo off
chcp 65001 >nul
cd /d "%~dp0"
start "" "http://127.0.0.1:{a.port}/"
python -c "import sys" >nul 2>nul && (python -m http.server {a.port} --bind 127.0.0.1 & goto :eof)
py -3 -c "import sys" >nul 2>nul && (py -3 -m http.server {a.port} --bind 127.0.0.1 & goto :eof)
echo Python 3 이 필요합니다. https://www.python.org/downloads/ 에서 설치한 뒤 다시 실행하세요.
pause
'''.replace('\n', '\r\n'), encoding='utf-8')
    size = sum(f.stat().st_size for f in out.rglob('*') if f.is_file()) / 1e6
    print(f'전후 비교 사이트: {out} ({size:.1f}MB)\n보기: Mac은 열기.command · Windows는 열기.bat 두 번 누르기')


if __name__ == '__main__':
    main()

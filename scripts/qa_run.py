#!/usr/bin/env python3
"""대신 걸어 보는 검사(tour.py make 의 4/4 단계)를 창 없는 크롬으로 돌린다: 사이트를 임시 서버로 열고 ?qa=tour · ?qa=corners 결과를 받아 온다.
  python3 qa_run.py <사이트폴더> [--only tour|corners] [--shots] [--tour-shots] [--timeout 240]
--shots 는 검수용 캡처(방마다 눈높이 장면 + 현관에서 본 복도)를 <사이트폴더>.shots/ 에 찍는다.
--tour-shots 는 투어 중 실제 화면(방에 도착해 자막이 뜬 뒤 2.4초)을 <사이트폴더>.tourshots/ 에 찍는다. 눈 검수 점수는 이것으로 매긴다.
통과면 종료 코드 0, 불합격이면 1, 크롬을 못 찾거나 결과를 못 읽으면 2(그때는 브라우저에서 주소 뒤에 ?qa=tour 를 붙여 연다).
결과는 <사이트폴더>/../<이름>.qa.json 에도 남긴다.
"""
import sys as _sys  # Windows 콘솔·파이프에서도 한글 출력이 깨지거나 멈추지 않게
for _st in (_sys.stdout, _sys.stderr):
    if hasattr(_st, 'reconfigure'): _st.reconfigure(encoding='utf-8', errors='replace')
import argparse, base64, functools, http.server, json, os, shutil, subprocess, sys, tempfile, threading, time, urllib.parse
from pathlib import Path

CHROMES = [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium', '/usr/bin/microsoft-edge',
] + [str(Path(b) / p) for b in filter(None, (os.environ.get('PROGRAMFILES'), os.environ.get('PROGRAMFILES(X86)'), os.environ.get('LOCALAPPDATA')))
     for p in ('Google/Chrome/Application/chrome.exe', 'Microsoft/Edge/Application/msedge.exe', 'BraveSoftware/Brave-Browser/Application/brave.exe')]


def find_chrome():
    if os.environ.get('CHROME'): return os.environ['CHROME']
    hit = next((c for c in CHROMES if os.path.exists(c)), None)
    return hit or next(filter(None, map(shutil.which, ('google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'chrome', 'msedge'))), None)
SHOW = ['몸묻힘비율', '카메라벽속', '화면가림프레임', '막힘', '계단실집안침범', '카메라위치튐', '최대이동ms', '시뮬초']


GOT = {}
SHOTS = Path('.')


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store'); super().end_headers()
    def do_POST(self):  # 페이지가 검사를 끝내면 결과를 여기로 보낸다
        n = int(self.headers.get('Content-Length') or 0); body = self.rfile.read(n)
        if self.path.startswith('/__shot'):  # 검수용 캡처 한 장(JPEG data URL)
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query); name = q.get('name', ['shot'])[0].replace('/', '·')
            SHOTS.mkdir(parents=True, exist_ok=True)
            (SHOTS / f"{int(q.get('i', ['0'])[0]):02d}_{name}.jpg").write_bytes(base64.b64decode(body.split(b',', 1)[1]))
        else:
            try: r = json.loads(body); GOT[r.get('시나리오')] = r
            except Exception: pass
        self.send_response(204); self.end_headers()
    def handle(self):
        try: super().handle()
        except (BrokenPipeError, ConnectionResetError): pass


def run(chrome, url, sc, timeout):
    with tempfile.TemporaryDirectory(ignore_cleanup_errors=True) as prof:  # Windows: 크롬이 늦게 놓은 파일 때문에 멈추지 않게
        cmd = [chrome, '--headless=new', '--no-first-run', '--no-default-browser-check', f'--user-data-dir={prof}', '--window-size=1280,800',
               '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--mute-audio', '--remote-debugging-port=0', url]
        pr = subprocess.Popen(cmd, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        t0 = time.time()
        while time.time() - t0 < timeout and sc not in GOT and pr.poll() is None: time.sleep(0.3)
        pr.terminate()
        try: pr.wait(5)
        except subprocess.TimeoutExpired: pr.kill()
    return GOT.get(sc)


def main():
    ap = argparse.ArgumentParser(); ap.add_argument('site'); ap.add_argument('--only'); ap.add_argument('--timeout', type=int, default=240); ap.add_argument('--shots', action='store_true', help='검수용 캡처도 찍는다(<사이트>.shots/)'); ap.add_argument('--angles', action='store_true', help='방마다 두 자리에서 찍는 검수용 캡처(<사이트>.angles/)'); ap.add_argument('--tour-shots', action='store_true', help='투어 중 실제 화면 캡처도 찍는다(<사이트>.tourshots/) — 눈 검수용')
    a = ap.parse_args(); site = Path(a.site).resolve()
    chrome = find_chrome()
    if not chrome: print('크롬을 찾지 못함(경로를 환경변수 CHROME 에 넣으면 그것을 쓴다) → 브라우저에서 주소 뒤에 ?qa=tour · ?qa=corners 를 붙여 열어 확인'); sys.exit(2)
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', 0), functools.partial(Quiet, directory=str(site)))
    threading.Thread(target=srv.serve_forever, daemon=True).start(); port = srv.server_address[1]
    results, code = {}, 0
    for sc in ([a.only] if a.only else ['tour', 'corners']):
        t0 = time.time(); r = run(chrome, f'http://127.0.0.1:{port}/?qa={sc}', sc, a.timeout)
        if r is None: print(f'  {sc}: 결과를 읽지 못함({time.time() - t0:.0f}초) → 브라우저에서 ?qa={sc} 로 확인'); code = max(code, 2); continue
        results[sc] = r; ok = r.get('합격')
        print(f"  {sc}: {'합격' if ok else '불합격'} ({time.time() - t0:.0f}초) · " + ' · '.join(f'{k} {r.get(k)}' for k in SHOW if k in r))
        if not ok:
            code = max(code, 1); print('    이유: ' + ', '.join(r.get('불합격이유', [])))
            for k in ('묻힘예', '카메라벽속예'):
                if r.get(k): print(f'    {k}: {r[k][:4]}')
    (site.parent / f'{site.name}.qa.json').write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding='utf-8')
    global SHOTS
    if a.shots:
        SHOTS = site.parent / f'{site.name}.shots'; shutil.rmtree(SHOTS, ignore_errors=True)
        r = run(chrome, f'http://127.0.0.1:{port}/?shots=1', 'shots', a.timeout)
        print(f"  검수용 캡처: {r['n']}장 → {SHOTS}" if r else '  검수용 캡처를 찍지 못함 → 브라우저에서 직접 찍는다')
    if a.angles:
        SHOTS = site.parent / f'{site.name}.angles'; shutil.rmtree(SHOTS, ignore_errors=True); GOT.pop('shots', None)
        r = run(chrome, f'http://127.0.0.1:{port}/?shots=angles', 'shots', a.timeout)
        print(f"  두 자리 캡처: {r['n']}장 → {SHOTS}" if r else '  두 자리 캡처를 찍지 못함')
    if a.tour_shots:
        SHOTS = site.parent / f'{site.name}.tourshots'; shutil.rmtree(SHOTS, ignore_errors=True); GOT.pop('shots', None)
        r = run(chrome, f'http://127.0.0.1:{port}/?shots=tour', 'shots', a.timeout)
        print(f"  투어 화면 캡처: {r['n']}장 → {SHOTS}" if r else '  투어 화면 캡처를 찍지 못함 → 브라우저에서 투어를 돌려 직접 찍는다')
    srv.shutdown(); sys.exit(code)


if __name__ == '__main__':
    main()

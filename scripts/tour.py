#!/usr/bin/env python3
"""평면도 → 3D 룸투어, 명령 하나로 끝까지.
  python3 tour.py walls <평면도 이미지> --name <이름> [--dark 100] [--thick 0]   벽 찾기 → <작업폴더>/walls.png · plan.json(빈 틀)
  python3 tour.py make <작업폴더>                                             장면 만들기 → 도면 검사 → 사이트 → 대신 걸어 보는 검사 → 검수용 캡처
                                                                              기본값 = 구조만(벽·문·창·바닥·바깥 + 붙박이 설비, 눈높이 1인칭)
  python3 tour.py make <작업폴더> --furnished                                 가구까지 넣는다(plan.json "furnished": true 와 같다)
작업폴더 = <저장 위치>/<이름>.work, 사이트 = 같은 자리의 <이름>/
저장 위치 = walls 의 --out > 환경변수 FLOORPLAN_TOUR_OUT > 지금 폴더(Claude Code를 연 폴더)/floorplan-3d-tour
make 는 단계마다 걸린 시간을 적고, 어느 단계에서든 실패하면 그 자리에서 멈춘다(종료 코드 1). 무엇을 고칠지는 그 단계 출력에 나온다.
"""
import sys as _sys  # Windows 콘솔·파이프에서도 한글 출력이 깨지거나 멈추지 않게
for _st in (_sys.stdout, _sys.stderr):
    if hasattr(_st, 'reconfigure'): _st.reconfigure(encoding='utf-8', errors='replace')
import argparse, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
def out_dir(arg=None):
    import os
    v = arg or os.environ.get('FLOORPLAN_TOUR_OUT')
    return Path(v).expanduser().resolve() if v else Path.cwd() / 'floorplan-3d-tour'


def step(label, cmd):
    t0 = time.time(); print(f'\n[{label}]', flush=True)
    code = subprocess.run([sys.executable, *map(str, cmd)]).returncode
    print(f'  → {"통과" if code == 0 else "실패"} ({time.time() - t0:.1f}초)', flush=True)
    return code


def main():
    ap = argparse.ArgumentParser(); sub = ap.add_subparsers(dest='cmd', required=True)
    w = sub.add_parser('walls'); w.add_argument('image'); w.add_argument('--name', required=True); w.add_argument('--dark', default='100'); w.add_argument('--thick', default='0'); w.add_argument('--out', help='저장 위치(기본: FLOORPLAN_TOUR_OUT 또는 ./floorplan-3d-tour)')
    m = sub.add_parser('make'); m.add_argument('work'); m.add_argument('--no-shots', action='store_true'); m.add_argument('--bare', action='store_true', help='구조만(기본값)'); m.add_argument('--furnished', action='store_true', help='가구까지 넣는다')
    a = ap.parse_args()
    if a.cmd == 'walls':
        work = out_dir(a.out) / f'{a.name}.work'; work.parent.mkdir(parents=True, exist_ok=True)
        code = step('벽 찾기', [HERE / 'plan.py', 'walls', Path(a.image).expanduser().resolve(), '--out', work, '--dark', a.dark, '--thick', a.thick])
        print(f'작업폴더: {work}\n다음: python3 tour.py make "{work}"'); sys.exit(code)
    work = Path(a.work).expanduser().resolve(); site = work.parent / work.name.removesuffix('.work')
    t0 = time.time()
    try:
        import json as _json; furnished = bool(_json.loads((work / 'plan.json').read_text(encoding='utf-8')).get('furnished'))
    except Exception: furnished = False
    a.bare = a.bare or not (a.furnished or furnished)
    if step('1/4 장면 만들기(자동 정리 포함)', [HERE / 'plan.py', 'build', work / 'plan.json'] + (['--bare'] if a.bare else ['--furnished'])): sys.exit(1)
    if step('2/4 도면 검사', ['-I', HERE / 'qa_static.py', work / 'scene.json']):
        if not a.bare: sys.exit(1)
        # 구조만: 붙박이 설비(조리대·욕조 등)를 대략 적은 자리가 문·벽과 부딪힌 것 → 걸린 종류를 빼고 한 번 다시(멈추지 않고 대략 동작)
        import re, subprocess as sp
        out = sp.run([sys.executable, '-I', str(HERE / 'qa_static.py'), str(work / 'scene.json')], capture_output=True, text=True).stdout
        bad = sorted(set(re.findall(r'(counter|shoe|toilet|vanity|bathtub|shower)·', out)))
        print(f'  → 설비 {", ".join(bad) or "전부"} 를 빼고 다시 만든다')
        if step('1/4 장면 다시 만들기', [HERE / 'plan.py', 'build', work / 'plan.json', '--bare', '--drop', ','.join(bad or ['counter', 'shoe', 'toilet', 'vanity', 'bathtub', 'shower'])]): sys.exit(1)
        if step('2/4 도면 검사(다시)', ['-I', HERE / 'qa_static.py', work / 'scene.json']): sys.exit(1)
    if step('3/4 사이트 만들기', [HERE / 'make_site.py', work, site]): sys.exit(1)
    code = step('4/4 대신 걸어 보는 검사' + ('' if a.no_shots else ' + 검수용 캡처'), [HERE / 'qa_run.py', site] + ([] if a.no_shots else ['--shots']))
    print(f'\n전체 {time.time() - t0:.0f}초 · 사이트: {site}' + ('' if a.no_shots else f' · 캡처: {site}.shots/'))
    try:  # 면적 5~10%(또는 areaConfirmed로 넘긴 방)는 사용자에게 보고한다
        import json; sc = json.loads((work / 'scene.json').read_text(encoding='utf-8'))
        for w in sc.get('areaWarn') or []: print(f"면적 확인 필요: {w['room']} {w['area']}㎡ / 표기 {w['stated']} ({w['diff']:+}%)")
        if sc.get('areaNote'): print(f"면적 메모: {sc['areaNote']}")
    except Exception: pass
    if code == 2: print('크롬으로 자동 검사를 못 했음 → 사이트를 브라우저로 열고 주소 뒤에 ?qa=tour · ?qa=corners 를 붙여 확인')
    sys.exit(1 if code == 1 else 0)


if __name__ == '__main__':
    main()

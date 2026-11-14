# chatdaeri-2d-3d

아파트·주택 평면도 이미지 한 장으로, 게임처럼 눈높이 1인칭으로 걸어 다니는 3D 공간 투어 웹사이트를 만드는 Claude Code 스킬. 기본은 구조만(벽·바닥·문·창·창밖 정원·붙박이 설비)이고, 외부 생성 서비스 없이 three.js와 스킬에 든 재료만 쓴다.

## 설치

Mac·Linux·Windows(Git Bash)

```
git clone https://github.com/chatdaeri/chatdaeri-2d-3d ~/.claude/skills/chatdaeri-2d-3d
python3 -m pip install numpy scipy pillow
```

Windows에서 `python3`가 없으면 `python` 또는 `py -3`로 바꿔 실행한다.

## 사용

Claude Code에서 평면도 이미지와 함께 "평면도로 3D 투어 만들어줘"라고 요청하거나 `/chatdaeri-2d-3d`를 호출한다. 동작 순서와 규칙은 `SKILL.md`에 있다.

## 저장 위치

기본값은 Claude Code를 연 폴더 아래 `floorplan-3d-tour/`다. 다른 곳에 두려면 환경변수 `FLOORPLAN_TOUR_OUT`을 정한다. `~/.claude/settings.json`에 넣으면 매번 적용된다.

```json
{ "env": { "FLOORPLAN_TOUR_OUT": "~/Documents/floorplan-3d-tour" } }
```

## 필요한 것

- Python 3.10 이상 (numpy · scipy · Pillow)
- 크롬 계열 브라우저(Chrome · Edge · Brave · Chromium) — 자동 검사용. 없으면 브라우저로 직접 확인한다. 찾지 못하면 환경변수 `CHROME`에 실행 파일 경로를 넣는다.

## 만든 사이트 보기

사이트 폴더의 `열기.command`(Mac) 또는 `열기.bat`(Windows)를 두 번 누른다. Linux는 사이트 폴더에서 `python3 -m http.server 4400`을 실행한 뒤 `http://127.0.0.1:4400/`을 연다.

## 구성

- `SKILL.md` — 스킬 본문
- `scripts/` — 평면도 분석·사이트 생성·검사
- `template/` — three.js 정적 사이트 템플릿과 재료 파일(재질·창밖·3D 가구)
- `references/` — plan.json 형식, 재료 파일 목록
- `examples/` — 시험용 평면도

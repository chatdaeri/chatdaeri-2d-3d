# 재료 파일 목록과 새 재료 넣는 법

스킬 안 `template/assets/`에 든 것이 기본 재료다. 사이트를 만들 때 그대로 복사되므로 외부 서비스나 크레딧이 필요 없다.

**외부 생성 서비스 규칙:** Higgsfield 같은 유료 생성 서비스는 사용자가 새 재료를 만들어 달라고 먼저 요청했을 때만 쓴다. 쓰기 전에 예상 크레딧과 남은 크레딧을 보여 주고 허락을 받는다. 허락이 없으면 스킬 안 재료와 코드로 그리는 것만으로 만든다.

## 지금 들어 있는 것

| 종류 | 파일(`template/assets/` 기준) | 쓰이는 곳 |
|---|---|---|
| 표면 재질 5종 | `tex/plaster·oak·oakfloor·limestone·travertine.jpg`(+`_n` 요철) | 기본 벽·마루·타일 |
| 표면 재질 6종(`style.tex`) | `tex/limewash·oakwide·porcelainstone·zellige·wool·boucle.jpg`(+`_n` 노멀맵) | plan.json에서 고를 때만 |
| 실내 조명용 하늘빛 | `tex/forest.jpg` | 빛 계산 |
| 창밖 나무 3종 | `ext/tree-zelkova·tree-cherry·tree-pine.png`(배경 투명) | 창밖 정원 |
| 창밖 바닥 | `ext/grass.jpg` · `ext/paver.jpg` | 창밖 정원 |
| 이웃 동 | `ext/building.png`(배경 투명) | 창밖 |
| 위생도기 3D | `furniture/toilet·vanity·bathtub.glb` | 붙박이 설비(기본) |
| 가구 3D | `furniture/` 나머지(소파·침대·식탁·의자·TV·화분·조명 등) | `furnished`일 때만 |
| 벽 그림 2장 | `art/calendar.jpg` · `art/shapes.jpg` | `furnished`의 `poster` |
| 코드로 그리는 것 | 조리대·신발장·샤워부스·붙박이장·포세린 타일·생활 소품 | 파일 없음(`src/furniture.js`·`src/props.js`·`src/look.js`) |

## 없는 재료가 필요할 때

1. **스킬 안**: 위 표. 가구 종류는 `scripts/plan.py`의 `FURN`, 3D 파일 연결은 `src/furniture.js`의 `GLB` 표.
2. **코드로 그리기**: 단순한 모양(상자·판·줄눈 타일)은 three.js 코드로 만든다.
3. **사용자가 가진 파일**: GLB·사진을 받으면 아래 "넣는 법"대로 등록한다.
4. **외부 생성 서비스**: 위 규칙대로 허락받은 뒤에만. 만든 파일은 아래 "넣는 법"대로 등록한다.

## 넣는 법

- **3D 가구**: `python3 scripts/shrink-glb.py 입력.glb 출력.glb 1024 84`로 텍스처를 줄여 `template/assets/furniture/<종류>.glb`에 두고, `src/furniture.js`의 `GLB` 표와 `scripts/plan.py`의 `FURN`(가로·깊이·높이 m)에 등록한다.
- **창밖 재료**: 나무는 배경이 투명한 PNG(1024px), 잔디·보도블록은 위에서 본 이음매 없는 질감. 잔디는 채도를 낮춰야 형광색으로 보이지 않는다.
- **표면 재질**: 그림자·빛이 없는 평평한 사진(위에서 본 모습, 화면 가득)을 준비한다. 그림자가 든 사진을 벽에 반복하면 얼룩 무늬가 된다. 타일은 줄눈 없는 한 장 판으로 준비하고 줄눈은 `make_tex.py --grout N`으로 그린다(반복해도 줄이 맞는다).
  `python3 scripts/make_tex.py <사진> <이름> [--grout N --grout-px 4 --tone 0.03] [--bump 2]` → `template/assets/tex/<이름>.jpg·_n.jpg`, `src/look.js`의 TILE에 실제 크기(m) 등록.
- 넣은 뒤 이 문서의 표에 한 줄 추가하고, `python3 scripts/tour.py make <작업폴더>`를 다시 돌려 검사를 통과하는지 본다.

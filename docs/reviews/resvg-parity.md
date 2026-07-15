# resvg-py 인프로세스 래스터화 동등성 판정

- 날짜: 2026-07-07
- 대상: `apps/worker/src/worker/render/raster.py`의 `rsvg-convert` 서브프로세스를
  resvg 파이썬 바인딩(PyPI `resvg-py`) 인프로세스 호출로 교체 가능한지 판정.
- 근거: ARCHITECTURE §9.1 이미지 파이프라인 — "resvg 인프로세스화, 렌더 결과 동등성
  확인 실패 시 librsvg 폴백".

## 판정: (b) 조건부 — librsvg 기준선 유지, 코드 무변경

두 렌더러는 **치수·형상·색·채움 영역이 동일**하나, 픽셀 단위로 byte/pixel-identical
은 아니다. 차이는 전부 도형 경계의 안티에일리어싱(AA) 전이 픽셀에 국한된다.
따라서 판정 기준 (a)(완전 동일 → 즉시 채택)에는 미달, (c)(구조적 차이 → librsvg
확정)에도 해당하지 않는 **(b) 조건부**다. 규약상 (b)는 코드를 바꾸지 않고 기록만
남긴다.

전환의 전제 조건: **finalize 결정론이 래스터 결과에 의존**한다(`render/fabric.py`
는 compose SVG를 래스터화한 뒤 weave 텍스처와 multiply). 렌더러를 교체하면
동일 intent+seed라도 최종 fabric PNG 바이트가 달라지므로, 전환 시 fabric/래스터
골든을 resvg 기준으로 **재베이스라인**해야 한다. 현재 골든 세트는 SVG 전용
(`tests/golden/svg`)이라 래스터 PNG 골든은 아직 없지만, "같은 intent+seed →
byte-identical" 계약의 하위에 래스터 산출물이 걸리는 순간 재기준선이 필수다.

## 방법

- 대조 셋: `apps/worker/tests/golden/svg/*.svg` 27종(25 패턴 + seed 변형 2).
- 치수: `raster.py`의 `mm_to_px = round(mm/25.4*dpi)` 재현, dpi=300.
  golden은 전부 48mm → 567px.
- rsvg-convert 2.62.3(cairo 1.18.4): `rsvg-convert -w 567 -h 567 -f png -`.
- resvg-py 0.3.3: `svg_to_bytes(svg_string=svg, dpi=300.0)`.
  - mm 단위 SVG는 dpi로 물리 치수를 해석해야 함(`dpi=0` 기본값 + width override
    단독은 `SVG has an invalid size`로 실패). dpi=300 → 48mm가 567px로 계산되어
    rsvg-convert의 `-w/-h`와 동일 치수 산출.
- 비교: Pillow로 RGBA 로드 후 채널별 절대차. 지표 — 치수 일치, 상이 픽셀 비율,
  최대 채널차, 차이 영역 침식(두께), rsvg 색경계로부터의 거리 분포.
- 스크립트: 스크래치패드 `parity.py`, `thickness.py`(세션 산출물, 미커밋).

## 수치

치수는 27종 전부 567×567로 rsvg=resvg=목표값 일치.

| 판정 지표 | 값 |
|---|---|
| pixel-identical 케이스 | 1/27 (`01_background_solid`, 도형 경계 없음) |
| 상이 픽셀 비율 | 0.5%~16.1% (도형 경계 길이에 비례) |
| 최대 채널차 | 17~79 (경계 전이 픽셀 한정) |
| **상이 픽셀 중 색경계 1.5px 이내 비율** | **전 케이스 100.00%** (최저 99.92%) |
| 색경계로부터 평균 거리 | 0.00~0.33px |
| 색경계로부터 p95 / max 거리 | 0~1px |
| 차이 마스크 2회 침식(=두께 5px+) 잔존 | 0~73px (수천 중, 사실상 소멸) |

diff 이미지(`diff_*.png`)에서 차이는 모티프 외곽선만 그리며 채움 내부는 완전 동일.

## 해석

- solid 배경은 완전 동일 → 색/형상/좌표 계산은 두 렌더러가 동일.
- 차이가 100% 색경계 ≤1.5px에 몰리고 침식 2회로 소멸 → cairo와 resvg의 **AA
  샘플링 알고리즘 차이**로 인한 경계 부분픽셀 커버리지 차(예: 대각 stripe 경계에서
  한 렌더러가 40%, 다른 렌더러가 60% 커버로 판정)일 뿐, 채워진 영역·형상·치수
  차이는 없음.
- 최대차 79도 완전 투명↔불투명 사이 전이 픽셀에서만 발생.

## 결론과 후속

- **코드 무변경.** `raster.py`는 librsvg(`rsvg-convert`) 서브프로세스 기준선 유지,
  `resvg` 폴백 분기도 유지. 프로젝트 의존성에 resvg-py 미추가.
- 인프로세스 전환(서브프로세스 spawn 제거)이 이후 성능/이식성 목적으로 필요해지면,
  전환 PR에서 (1) fabric/래스터 골든을 resvg로 재베이스라인, (2) 결정론 교차
  테스트(PYTHONHASHSEED)를 resvg 기준으로 재실행, (3) Dockerfile은 librsvg를
  폴백으로 남길지 결정 — 을 함께 처리해야 한다.

# 배치형(placement) 넥타이 디자인 — 실행 기록 (2026-10-16)

플랜 `docs/plans/tie-placement-print.md`(삭제)를 실행했다. 넥타이 한 장에 **한 번만** 놓이는 무늬와 포인트
로고를 intent `panel`로 엔진·api·store·finalize에 넣고, 참조 이미지의 배치형 6종을 시드 템플릿으로 추가했다.

## 한 일

- **엔진** — `Intent.panel`(region·line·curve_band·motif, 기본 None), `engine/panel.py:compose_panel`이 타일과
  별개 SVG(`design.panel_svg`)를 만든다. `iter_motif_ids`·`ordered_slot_refs`·`validate_intent`가 panel을
  포함, `set_motif_slot(slot="logo")`가 panel 로고만 바꾼다. 명세: `docs/api-spec/worker-engine.md` §2b.
- **finalize** — `tie_mockup_png(panel_svg=…)`가 넥타이 목업에 panel을 한 번 얹어 실사화 참고로 쓴다
  (`worker-pipeline.md` §2.1). 정본 타일엔 panel이 없다(디자이너가 실사화를 보고 다시 그림).
- **api** — `DesignOut.panel_svg`(정화), `DesignSessionOut.preview_panel_svg`, `DesignExampleOut.panel_svg`·
  `logo_in_panel`, 로고 넣기는 panel 로고가 있으면 `slot:"logo"`. 모티프 접근 검사(`_ensure_intent_motif_access`)와
  예시 등록의 비공개 모티프 검사가 panel 모티프까지 본다. `domains.md` §11, codegen 갱신.
- **store** — `TieCanvas` `panelSrc` + `SILHOUETTES[*].blade`(마스크 실측) 사상, 목록·색 고르기·로고 화면 연결.
  색 고르기의 즉시 미리보기는 panel에도 같은 치환을 적용한다. panel 로고면 엠블럼 오버레이를 끈다.
- **시드** — `CuratedExample.panel`, 템플릿 6종(카테고리 칩 `포인트`), 모티프 5종(bars·initialc·initialn·
  vine·brushstroke). 스킬 `tie-template`에 "배치형(panel)" 절.

## 플랜과 달라진 것

- **블레이드 프레임을 등방 단위로** 바꿨다. 플랜은 y를 블레이드 길이 0..1로 정규화했지만, 평면 카드 블레이드는
  ≈1.3 폭·실사 컷은 ≈5.5 폭이라 비등방 사상은 실루엣마다 사선 각도와 로고 비율을 다르게 만든다(플랜의 실패
  모드 그대로). x 0..1000 = 어깨 폭, 어깨선 y=1000, viewBox `0 -4600 1000 6200`.
- 로고 크기 상한은 `MotifDef.bbox_mm`이 아니라 symbol geometry의 tight bbox로 잰다 — 정규화 모티프의 bbox는
  늘 단위 박스라 가로세로 비가 없다.

## 검증

- worker: `test_panel.py`(결정론·colorway·검증·`iter_motif_ids`·로고 교체·슬롯 교체 시 panel 보존),
  `test_photoreal.py`(목업에 panel이 블레이드 아래에만), 골든 포함 엔진·patch·validate·api 테스트 통과.
- api: `test_design.py`·`test_design_examples.py`·`test_contract.py` 288개 통과(panel 로고 슬롯, 갤러리 필드).
- store(browser-use): `/design` 카드 6종 한 번씩, 상세 실사 컷·끝 확대에서 같은 위치, 색 고르기에서 panel 색
  즉시 반영, 로고 넣기 후 panel 로고 한 번(넓은 로고 잘림) 확인.
- **안 한 것**: 실제 gpt-image 실사화 1회(유료) — 결정론 참고 목업에 panel이 얹히는 것까지만 확인했다. 운영
  반영 시 deploy.yml이 api를 먼저 배포하므로 **배치형 템플릿 시드는 worker 배포 뒤** 실행한다(옛 worker는
  `extra="forbid"`로 panel intent를 거부).

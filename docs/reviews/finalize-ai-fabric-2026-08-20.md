# AI 실사화 finalize 캡슐 — 실행 결과 (2026-08-20)

`docs/plans/finalize-ai-fabric.md`(제거됨)의 실행 기록. finalize의 고객 대면
산출물을 절차적 질감 합성에서 AI 실사화(gpt-image 편집 2회)로 교체하는 worker
캡슐을 구현하고, 실호출 캘리브레이션으로 품질 게이트를 통과했다(사용자 승인).

## 구현

- **어댑터** `apps/worker/src/worker/adapters/gpt_image.py` — 재시도·b64 검증·
  usage 로깅을 `_request_png`로 추출, `edit()` 추가(`/images/edits` 멀티파트,
  `image[]` 다중 입력 + 선택 마스크). 공식 문서 확인: gpt-image-2 편집 지원,
  마스크는 첫 이미지에 적용·동일 크기·알파 필수·**투명(알파 0)=편집 영역**,
  input_fidelity는 gpt-image-2 자동.
- **캡슐** `apps/worker/src/worker/render/photoreal.py` — 넥타이 실사는 고정
  베이스 사진(`render/assets/photo/tie-base.png`, 1024×1536)의 넥타이 영역만
  마스크 인페인팅으로 교체(참고: TieCanvas 기하의 결정론 넥타이 렌더 + 직조
  실물 사진). 원단 실사는 타일 3×3 + 직조 사진. weave→프롬프트 매핑 표가
  에셋·KNOWN_WEAVES와 3곳 결속(테스트 핀). 편집 2회 병렬, 1회 실패 = 전체 실패.
- **마스크** `tie-base-mask.png` — 베이스 사진에서 생성(휘도 임계→중앙 성분→
  구멍 채우기→2px 침식), 오버레이 육안 검증. 베이스가 고정이라 영구 재사용.
- **라우트** `/finalize` — dpi 422 → 어댑터 미구성 503(폴백 없음) → 준비 422 →
  업스트림 4xx 422(`FINALIZE_UPSTREAM_REJECTED`)·그 외 502 → 업로드 3파일:
  `result = {tie_object_key, fabric_object_key, tile_object_key, object_key(레거시 별칭=fabric)}`.
  정본 타일(`tile/` 프리픽스) = 현행 `render_fabric` 출력 그대로.
- **설정** `finalize_image_quality`(기본 medium). **테스트** `test_photoreal.py`
  5건 + `test_finalize_jobs.py` 13건 재작성(어댑터 대역), fabric 골든 21건 무변경
  통과 — 절차 렌더 결정론 유지. ruff·pyright 클린.
- **캘리브레이션 도구** `apps/worker/scripts/calibrate_photoreal.py`
  (`--confirm-live`, 골든 3종 × weave 3종).

## 캘리브레이션 (실호출, 2026-08-20)

9/9 성공. 육안 기준: (a) 색 유지 통과 (b) 모티프 형태 — 원단 접사 통과, 넥타이
스케일에선 미세 모티프 디테일 뭉개짐 (c) weave 구분 뚜렷(트윌/헤링본/자카드 —
이 개편의 핵심 목표 달성) (d) 셔츠·매듭·조명 유지, 마스크 경계 자연 (e) 절차
렌더 대비 압도적 우위. **사용자 승인으로 게이트 종료.**

- 지연 실측: 9조합(각 편집 2회 병렬) 약 7분 → **조합당 ~45s** (quality=medium).
  컷오버의 타임아웃 검토(180s) 여유 있음.
- 단가: usage 로그가 INFO 레벨이라 스크립트 실행에선 미포집 — 컷오버 3항에서
  요금표 + 운영 로그로 확정할 것.

## 알려진 한계 (컷오버를 막지 않음)

- **패턴 스케일 드리프트**: 넥타이 실사의 줄 간격·모티프 밀도가 참고 렌더보다
  ~2배 성김. 색·리듬·비례는 유지. 개선 여지: 프롬프트에 밀도 고정 지시
  ("match the stripe count of the second image") 또는 넥타이만 quality=high.
  프롬프트는 `photoreal.py` 상수 한 곳에 있다.
- 넥타이에 인접한 셔츠 그림자 일부가 마스크(편집 허용 영역)에 포함 — 모델이
  그림자를 재생성하므로 무해함을 캘리브레이션으로 확인.

## 배포 주의

이 상태로 main 머지 시 finalize가 즉시 AI 경로가 된다(키 없으면 503, 있으면
유료 편집 2회/건). **`finalize-ai-cutover-2026-08-20.md`(과금 재산정·store 배선·명세 갱신)와
같은 릴리스로 내보낼 것.**

# 색상 시스템 개선 플랜

> 가정(샘플로 확인됨): Recraft flat 스타일은 부위마다 고유한 flat 색을 쓴다
> (`tests/fixtures/recraft_samples/pelican_bicycle_side.svg` — 흰 몸통·파란 자전거·
> 주황 부리·검정 윤곽). 슬롯은 색 단위이므로 **슬롯 ≈ 부위**가 성립한다.
> 단 Recraft API는 SVG 데이터만 반환하고 부위명·레이어명·path id 등 의미
> 메타데이터는 없다(공식 문서·샘플 확인) — 부위명은 자체 비전 라벨링으로 만든다.
> 목표: 슬롯에 부위명을 부여해 의도 있는 배색과 "자전거는 파란색" 부위 지정
> 리컬러를 가능하게 한다. Plan 스키마는 유지.

## 1. 슬롯 ≈ 부위 가정을 소스에서 강화 (Recraft 호출 개선)

1. Recraft 프롬프트(`worker/adapters/recraft.py` `_build_recraft_prompt`)에 규칙
   추가: "서로 다른 부위는 서로 다른 flat 색을 쓰고, 무관한 부위에 같은 색을
   재사용하지 말 것."
2. `controls.colors`로 디자인 팔레트 전달: 플랜의 `colors`를
   `{"rgb":[r,g,b]}` 배열로 변환해 생성 요청에 포함 — 모티프가 처음부터 디자인
   팔레트 색으로 그려져 리컬러 필요성이 줄고 슬롯 색이 정합된다. 색 준수는
   소프트 제약이므로 결과는 게이트·양자화가 현행대로 방어한다.
   선행: V4.1 vector에서 controls 지원 스모크 확인(`artistic_level`/`no_text`만
   V3 전용 표기, colors는 미표기). 통합 지점: `generate_motif` 호출부에 팔레트
   전달 경로 추가.
3. `negative_prompt` 추가("gradient, texture, photorealistic shading") — 현행
   게이트 거부 후 재프롬프트 루프를 사전 억제로 감축.
4. `random_seed` 전달 — 생성 재현성·디버깅용.
5. 주의: `recraft_max_color_slots=6`(`config.py`) 양자화가 비슷한 색을 병합해
   부위 분리를 깨뜨릴 수 있다. 1·2로 색 대비가 커지면 병합 확률이 줄어든다.
   부위 병합이 관찰되면 설정 상향을 검토(코드 변경 불필요).

참고(이번 범위 밖): `POST /images/vectorize`(래스터→SVG, 사진 모티프 경로 —
코드 주석의 "5단계 재도입"과 연결), `POST /styles` 커스텀 스타일(카탈로그
모티프 스타일 일관성). Recraft API는 부위명·레이어명 등 의미 메타데이터를
반환하지 않는다(공식 endpoints 문서·V4.1 샘플 확인) — 부위명은 §2의 자체
라벨링이 유일한 경로다.

## 2. 슬롯 부위명 부여 (자체 비전 라벨링 확장)

1. 라벨러 확장(`worker/motifs/labeler.py`): 등록 시 도는 기존 비전 호출의 응답
   스키마에 슬롯별 짧은 부위명 배열(`parts`, 슬롯 수와 동일 길이)을 추가한다.
   부위명은 sanitize(`sanitize_facet_text`/`is_suspicious_facet_text`)를 통과한
   것만 저장, 실패 시 부위명 없이 저장. 같은 색을 공유하는 부위는 한 슬롯이므로
   묶어서 명명("부리·안장")하도록 프롬프트에 지시.
2. DB: `motifs.slot_parts` 컬럼 추가 — Alembic 경유.
   `apps/worker/scripts/backfill_slot_labels.py`를 부위명 포함으로 확장해 기존
   모티프를 백필한다.

## 3. 프롬프트 노출 + 바인딩 정합

1. `worker/adapters/gemini.py`: 카탈로그 후보 레코드, current_motif alias,
   exact input 안내에 `slot_count`(= `color_slots` 길이)와 부위명(있을 때만)을
   추가한다. 부위명은 subject/description과 같은 untrusted 블록 경로로.
2. 프롬프트 규칙 추가: 리컬러 시 `color_indices`는 `slot_count` 개수만큼,
   i번째 인덱스가 i번째 부위에 배정된다.
3. 바인딩(`worker/api/routes.py` `_bind_resolved_motif_colors`): 부위명이 있는
   모티프는 라벨 랭크 재정렬 대신 슬롯 원 순서로 배정해 1의 노출 순서와
   일치시킨다.
4. generate/reference 소스와 부위명 없는 모티프(비전 실패·단색·사진 유래)는
   현행 유지(`color_indices` 생략 → 원본 색).

## 4. 색상 팔레트 라이브러리 검색 (조건부)

착수 조건: 1~3 + few-shot 시범 팔레트 교정 반영 후에도 배색이 불만족일 때만.

1. 새 테이블 `colorway_library`(name, mood tags, colors HEX 2~8) — Alembic 경유.
2. 큐레이트 팔레트 100~300세트 시드(멱등 스크립트).
3. 무드 텍스트를 기존 Vertex 임베딩 인프라로 색인(authoring examples 패턴 재사용).
4. 생성 요청 시 사용자 프롬프트로 top-2~3 검색해 프롬프트에 제안으로 주입
   ("채택·변형 또는 무시"). 색은 현행대로 `colors` 배열 + 인덱스로 내려온다.
5. admin에 라이브러리 CRUD 추가.

## 별도 진행 (이 플랜 범위 밖)

few-shot 시범 25개의 공유 8색 팔레트는 시범 데이터 교정 작업에서 시범별 팔레트로
교체한다(admin 편집으로 반영, 골든 회귀와 무관).

## 검증

- 1번 착수 전: V4.1 vector에 `controls.colors` 포함 요청 스모크 1회 — 수용 여부와
  색 반영 정도 확인 후 2를 진행/보류 결정.
- 1번 후: 신규 Recraft 모티프의 슬롯 색이 요청 팔레트와 겹치는 비율, gradient
  게이트 거부율 전/후 비교.
- 2번 후: 신규 Recraft 모티프의 slot_parts 저장 여부와 부위명-실제 그림 일치를
  admin에서 표본 확인.
- 3번 후: 채팅 리컬러 스모크 — "자전거는 파란색" 요청이 해당 슬롯 인덱스만
  바꾸는지 plan diff로 확인. `color_indices` 길이-슬롯 수 일치율 전/후 비교.
- `uv run pytest` 통과(모티프 정규화·바인딩 골든 포함).
- 4번 착수 시: 무드 프롬프트 스모크로 검색 팔레트 채택 여부를 generation log에서
  확인.

## 상태 — 계획

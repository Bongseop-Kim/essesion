# 6단계 — admin 단수화, 죽은 코드 스윕, 문서 정리

> 총괄: `00-overview.md`. 선행: 1–5단계 전부.

## 목표

재설계로 참조가 끊긴 코드·데이터·문서·정책을 **삭제**하고, 남은 문서를 새 구조에 맞춘다.
이 단계가 끝나면 저장소에 "후보"·"패턴 4축"·"전체 재저작"이라는 개념이 남아 있지 않다.

## 1. admin 반영

| 대상 | 작업 |
|---|---|
| `apps/admin/src/pages/generation/seamless-list.tsx`(+test) | 후보 개수 열·라벨 삭제, 생성 1건 = 디자인 1개로 표기 |
| `apps/admin/src/pages/generation/seamless-detail.tsx`(+test) | 후보 배열 렌더 → 단일 디자인. `intents`/`plans` 배열 가정 제거 |
| `apps/admin/src/pages/generation/generation-labels.ts` | `candidate_count`·후보 관련 라벨 삭제, patch/scope_rejected 진단 라벨 추가 |
| `apps/api/src/api/domains/admin/generation.py` | 응답에서 `candidate_count` 삭제, patch 진단 필드 노출(`patch_axes`, `scope_rejected`) |

`apps/admin/src/pages/authoring/candidates-list.tsx`·`candidate-detail.tsx`는 **오소링 승격
후보**로 이번 재설계와 무관하다. 이름이 비슷하다고 건드리지 않는다.

## 2. 죽은 코드 스윕

```bash
# 참조 0건 확인 후 삭제 (dist·node_modules 제외)
grep -rn "candidate_count\|candidateCount" apps packages db docs --include="*.ts" --include="*.tsx" --include="*.py" --include="*.md"
grep -rn "pattern_constraints\|PatternConstraints\|patternConstraints" apps packages db docs
grep -rn "reroll\|/branch" apps packages docs
grep -rn "turn-feed\|candidate-grid\|pattern-settings-modal\|preview-panel\|finalize-turn" apps
```

- `apps/store/node_modules/.cache/react-doctor/dead-code-summaries.json`는 캐시다 — 무시.
- `apps/*/dist`는 빌드 산출물이다 — 무시.
- 남은 store 로컬 유틸 중 참조가 끊긴 것(예: `warnings.ts`가 새 알림 매핑으로 대체되면)은
  같은 커밋에서 삭제한다.
- `apps/worker/scripts/eval_authoring.py`가 `pattern_constraints`를 쓴다 — 스크립트도 갱신하거나
  쓰이지 않으면 삭제한다(판단 근거를 커밋 메시지에 남긴다).

## 3. 데이터 폐기

- 로컬·스테이징 DB의 `design_sessions`/`design_session_turns`는 **버린다**. 후보 배열이 담긴
  payload는 새 스키마로 읽을 수 없고, 마이그레이션할 가치가 없다.
- 베이스라인(`db/migrations/versions/20260722_dadd999bf858_baseline.py`)이 미배포이므로 새
  리비전을 쌓지 않고 베이스라인을 고친 상태를 유지한다. `head → base → head` 왕복과 model
  drift 검사가 통과해야 한다.
- 스테이징이 이미 떠 있으면 스키마를 새로 만든다(`CHECKLIST` §2 항목과 함께 처리).

## 4. 문서

| 문서 | 작업 |
|---|---|
| `ARCHITECTURE.md` §2(세션·턴 소유) · §7(Recraft 예산) | 후보·refine 서술을 스텝·patch로 갱신 |
| `docs/api-spec/worker-pipeline.md` | 생성 파이프라인을 단일 디자인 + patch로 재작성, refine 보존 서술 삭제 |
| `docs/api-spec/worker-engine.md` | 후보 팬아웃·4축 서술 삭제, `compose_design` 계약으로 |
| `docs/api-spec/worker-motifs.md` | 문장 → `MotifSpec` 변환 단계 추가 |
| `docs/api-spec/domains.md` | design 엔드포인트 목록 갱신(reroll·branch 삭제, steps/activate·motifs/search·motifs/activate 추가) |
| `docs/specs/design-generation-controls.md` | **삭제**(3단계에서 수행, 여기서 링크 잔존 확인) |
| `docs/CHECKLIST.md` | 재설계 관련 미완료 항목만 남기고 갱신 |
| `docs/plans/design-redesign/` | 실행 완료 후 **삭제**하고 결과를 `docs/reviews/design-redesign-2026-XX.md`에 기록 (AGENTS.md 규칙) |

## 5. 과금 확정 (미결 M1)

- 현재는 `get_generate_cost` 단일 값(생성 1회 5토큰).
- 이번 재설계로 비용 구조가 갈린다: **구성 수정**(patch, flash-lite 1콜) / **모티프 검색**(무료) /
  **모티프 생성**(Recraft) / **첫 생성**(전체 저작 + 모티프 해결).
- 최소 변경안: `admin_settings`에 `design_edit_cost`(구성 수정)를 추가하고
  `ledger.use_tokens(..., cost_key=...)`로 분기한다. 모티프 생성은 기존 5토큰 유지.
- 첫 생성을 구성 수정과 같은 값으로 둘지 별도로 둘지 이 단계에서 확정하고, admin 설정 화면과
  store 표기(`토큰 pill` 상세)를 맞춘다.

## 6. e2e

- `e2e/store-money-path.spec.ts`는 현재 디자인 경로를 다루지 않는다(`design` 언급 0건).
  이번 재설계에서 새로 추가할지는 `.claude/skills/e2e-test-harness/SKILL.md` 게이트로 판단한다.
  기본값은 **추가하지 않음** — 디자인 경로는 외부 provider 의존이 커서 E2E보다 Aside 수동
  체크포인트가 낫다.
- 추가한다면 범위는 "세션 생성 → 구성 수정 1회 → 이력 되돌리기"까지. 모티프 생성은 제외.

## 검증

```bash
uv run pytest && uv run ruff check . && uv run pyright
pnpm lint && pnpm turbo build typecheck test
pnpm codegen   # 드리프트 0
uv run alembic -c db/alembic.ini upgrade head && uv run pytest tests/test_migrations.py
```

## 완료 판정

1. 2절의 grep 4개가 모두 0건(dist·node_modules 제외)
2. 문서 표의 작업이 전부 반영되고, 삭제 대상 문서로 향하는 링크가 없다
3. `docs/plans/design-redesign/`가 제거되고 `docs/reviews/`에 실행 기록이 있다
4. 과금 키와 store 표기가 일치한다

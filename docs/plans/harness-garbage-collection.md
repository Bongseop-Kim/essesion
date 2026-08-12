# 하네스 가비지 컬렉션 도입 플랜

상태: 진행 중 — 계측·비차단 자동화·구조 gate 구현, 운영 관찰과 첫 GC PR 대기

이 문서는 현재 CI와 아키텍처 경계를 보존하면서 코드·문서·구조·하네스 드리프트를
증분 상환하기 위한 실행 지침이다. 각 단계는 앞 단계의 센서 신뢰도가 확인된 뒤에만
진행한다. 완료 후 결과를 `docs/reviews/harness-garbage-collection.md`에 기록하고 이 파일은
`docs/plans/`에서 제거한다.

## 1. 목표와 성공 조건

### 목표

1. 결정적 센서가 드리프트 후보를 수집하고, 사람 또는 에이전트는 후보의 의미만 판단한다.
2. 레거시 잔량은 기준선으로 동결하고 신규 유입만 먼저 드러낸다.
3. 정리 변경은 제품 변경과 분리하며 작고 되돌릴 수 있게 유지한다.
4. 센서의 실행 시간·발화·억제·오탐도 함께 기록해 하네스 자체를 정리할 수 있게 한다.

### 완료 조건

- 코드·문서·구조 센서가 고정된 버전과 고정된 스코프로 재현 가능하게 실행된다.
- 모든 센서가 공통 요약 JSON을 만들고 현재 기준선 대비 증감과 수정 지침을 표시한다.
- 정기 실행은 기존 CI를 차단하지 않고 결과와 실행 시간을 artifact로 남긴다.
- 두 번 연속 같은 입력에서 기준선 수치가 재현되고, 알려진 동적 진입점의 오탐이 제거된다.
- 신규 위반 차단은 오탐 없는 규칙에만 적용되고 기존 위반은 늘어날 때만 실패한다.
- 첫 GC 변경은 단일 관심사의 수동 리뷰 PR로 검증되며 자동머지는 사용하지 않는다.

## 2. 현재 기준선

### 이미 있는 하네스

- JS/TS: Biome, TypeScript, Vitest, Vite build, Playwright, OpenAPI codegen drift
- Python: Ruff, Pyright, pytest, Schemathesis, Alembic drift
- 보안·공급망: OSV scanner, 고정 SHA GitHub Actions
- 저장소 규칙: `scripts/check-harness.mjs`가 디자인 토큰과 인증 이동 규칙을 교정 메시지와 함께 차단
- 컨텍스트: 루트 `AGENTS.md`와 영역별 `AGENTS.md`가 있고 `CLAUDE.md`는 별도 백과사전이 아니라 해당 지침을 가리키는 짧은 포인터다.
- 문서 수명주기: 미실행 작업은 `docs/plans/`, 완료 결과는 `docs/reviews/`에 둔다.

따라서 기존 검사기를 교체하거나 문서 트리를 전면 재구성하지 않는다. 루트 `AGENTS.md`는
현재 182줄로 상한 300줄 안에 있으므로 이번 작업에서 축소를 목표로 삼지 않는다.

### React Doctor 진단

다음 진단을 실행했다.

```bash
npx react-doctor@latest --verbose
```

- 실행 버전: `0.9.11`
- 스캔 대상: `admin`, `store`, `@essesion/shared`
- 점수: 58/100
- 결과: 200건 — 오류 8건, 경고 192건
- 우선 트리아지: 렌더 중 ref 변경 8건, object URL 수명주기, effect dependency, mutation cache invalidation
- 기준선 전용: 대형 컴포넌트, 다수 `useState`, 컴포넌트 파일의 비컴포넌트 export 같은 취향·구조 경고

이 수치는 일괄 수정 목록이나 품질 등급으로 쓰지 않는다. 자동 실행에서는 `latest` 대신
`0.9.11`을 고정하고 `--yes --json --no-telemetry --blocking none`으로 수집한다. 오류 8건도
코드를 읽어 실제 결함인지 확인한 뒤 별도 PR로 처리한다.

## 3. 채택 범위

### 지금 채택

| 영역 | 센서 | 초기 스코프 | 초기 정책 |
|---|---|---|---|
| JS/TS 데드 코드 | Knip | `apps/*`, `packages/shared`, Cloudflare proxy | 리포트 전용 |
| Python 데드 코드 | Vulture, confidence 60 | `apps/api`, `apps/worker`, `libs`, `db` 런타임 | 리포트 전용 |
| 구문 중복 | jscpd, min-lines 5 | TS/TSX와 Python을 분리 실행 | 리포트 전용 |
| React 결함 후보 | React Doctor 0.9.11 | admin, store, shared | 오류 우선 수동 트리아지 |
| 문서 드리프트 | repo-owned 링크·경로 검사 | `AGENTS.md`, `ARCHITECTURE.md`, `docs/` | 확정적 오류만 차단 후보 |
| 구조 드리프트 | dependency-cruiser, import-linter | `ARCHITECTURE.md` §4.2의 허용 간선 | 기존 위반 freeze 후 신규만 차단 |
| 하네스 건강 | 센서 런너 자체 지표 | 실행 시간, 발화 수, 억제 수, 파서 실패 | 항상 기록 |

### 뒤로 미룸

- PurgeCSS: Tailwind의 동적 클래스와 시맨틱 토큰 오탐 범위를 먼저 규정해야 한다.
- similarity-ts: 구문 중복과 수동 모듈성 리뷰에서 실제 필요가 확인될 때만 추가한다.
- 전체 뮤테이션 테스트: 센서 기반이 안정된 뒤 돈·인가·결정론 모듈의 변경 파일 파일럿부터 시작한다.
- pre-commit/pre-push 강제 설치: 변경 파일용 명령이 5초 안에 안정적으로 끝난 뒤 별도 결정한다.
- 자율 수정·PR 생성·자동머지: 두 번의 정기 실행과 한 번의 수동 GC PR이 안전성을 입증한 뒤 검토한다.
- `docs/` 전면 재편과 컨텍스트 파일 재작성: 현재 저장소 관례가 이미 역할을 분리하므로 별도 문제 없이 구조만 바꾸지 않는다.
- 파일/함수 길이와 복잡도 일괄 차단: 현재 분포를 수집하고 영역별 임계값을 정하기 전에는 활성화하지 않는다.

## 4. Phase 0 — 결정적 계측

### 4.1 센서 버전과 진입점 고정

- [x] Knip, jscpd, React Doctor를 루트 devDependency에 정확한 버전으로 고정한다.
- [x] Vulture를 uv dev dependency에 정확한 버전으로 고정한다.
- [x] Knip 설정에 Vite 앱, package export, 스크립트, 동적 import, 공개 패키지 surface를 등록한다.
- [x] 생성물 `packages/api-client`, Alembic revision, test fixture, snapshot, asset, lockfile을 해당 센서에서 제외한다.
- [x] jscpd는 TS/TSX와 Python을 분리 실행한다. 언어 간 유사도는 비교하지 않는다.
- [x] Vulture 결과는 confidence 60 이상만 수집하고 테스트와 migration은 자동 삭제 대상에서 제외한다.

검증:

```bash
pnpm gc:sensors
pnpm gc:sensors
```

두 실행의 finding ID와 metric 값이 같아야 한다. 시간·run ID처럼 변하는 메타데이터는 비교에서
제외한다.

### 4.2 최소 센서 런너

다음만 추가한다.

```text
scripts/gc/
├── run.mjs              # 센서 실행과 종료 코드 관리
├── normalize.mjs        # 도구별 native JSON → 공통 요약
└── schema.json          # 요약 스키마
gc.config.json           # 명령, 방향, 목표, 스코프, 기준선 위치
gc-baseline.json         # 검토된 현재 잔량
```

공통 요약에는 다음 필드만 둔다.

- `sensor`, `tool_version`, `scope`, `status`, `duration_ms`
- `metrics[]`: 이름, 값, 방향(`higher|lower`), 목표, 기준선, delta
- `findings[]`: 안정 ID, 규칙, 심각도, 파일·줄, 메시지, 수정 지침
- `suppressed_count`, `parser_errors`, `partial`

원본 JSON은 로컬 임시 디렉터리와 CI artifact에만 둔다. 타임스탬프가 계속 변하는 전체 리포트를
저장소에 커밋하지 않는다. 공통 요약 파서가 실패하거나 부분 실행이면 성공 수치로 기록하지 않는다.

### 4.3 베이스라인 검토

- [x] 센서별 결과를 항목 종류 단위로 검토한다: unused files, unused exports, dependencies, duplicate blocks.
- [x] 동적 진입점과 공개 API 오탐은 설정으로 해결한다. 인라인 억제로 먼저 숨기지 않는다.
- [x] React Doctor 오류 8건은 실제 렌더 경로와 테스트를 읽고 `bug`, `intentional`, `tool false-positive`로 분류한다.
- [x] 기준선과 분류 결과를 `docs/reviews/harness-gc-baseline.md`에 기록한다.
- [x] `gc-baseline.json`은 사람이 검토한 결과에서만 갱신한다.

Phase 0 종료 조건:

- 두 번 연속 실행이 같은 결과를 낸다.
- 각 finding에 수정 지침이 있다.
- 런너가 어떤 센서 실패도 빈 성공 결과로 바꾸지 않는다.
- 기존 `pnpm lint`, build/typecheck/test, Ruff, Pyright 결과는 변하지 않는다.

## 5. Phase 1 — 리포트 전용 자동화와 좌측 배치

### 5.1 정기 실행

- [x] 주간 `gc-sensors.yml` workflow를 추가한다.
- [x] workflow는 읽기 권한으로 checkout하고 코드·문서·PR을 수정하지 않는다.
- [x] 공통 요약, 원본 리포트, 실행 시간을 artifact로 보존한다.
- [x] job summary에는 센서별 현재값, 기준선 delta, 방향, 목표, 신규 finding만 표시한다.
- [x] 네트워크 또는 파서 실패는 `unknown`으로 표시하고 수치 개선으로 해석하지 않는다.

### 5.2 변경 중 피드백

- [x] `pnpm gc:changed --base <ref>`를 제공해 React Doctor와 가능한 센서를 변경 파일에 한정한다.
- [x] PR CI에서는 기존 gate를 그대로 유지하고 GC 결과는 summary로만 노출한다.
- [x] 변경 파일 검사가 5초를 넘으면 느린 센서를 로컬 경로에서 제외하고 주간 실행에만 둔다.
- [x] 훅은 자동 설치하지 않는다. 반복 실행 시간과 산만함을 확인한 뒤 opt-in 스크립트만 검토한다.

Phase 1 종료 조건:

- 두 번의 정기 실행 artifact를 비교할 수 있다.
- 신규 finding과 레거시 잔량이 분리된다.
- 기존 CI 시간과 실패율에 유의미한 회귀가 없다.
- 오탐 규칙은 차단 후보에서 제외되거나 스코프가 교정된다.

## 6. Phase 2 — 문서·구조의 신규 드리프트 차단

### 6.1 문서 센서

- [x] repo-owned 검사로 로컬 Markdown 링크, 존재하지 않는 경로·스크립트, `docs/plans/`와 `docs/reviews/` 수명주기 위반을 확인한다.
- [x] `agents-lint`는 일회성 비교 평가만 하고 저장소 고유 규칙보다 정확한 항목만 채택한다.
- [x] `AGENTS.md` 내용 평가는 자동 수정하지 않는다. 300줄 초과, 중복 포인터, 깨진 참조처럼 결정적인 항목만 센서화한다.
- [ ] 문서 부족이 같은 코드 실수로 두 번 나타난 경우에만 문서를 보강하거나 코드 규칙으로 승격한다.

### 6.2 구조 센서

`ARCHITECTURE.md` §4.2를 다음 허용 간선의 정본으로 사용한다.

```text
store/admin -> api-client, shared
api-client <- generated OpenAPI
api -> db, libs/obs, libs/svg-safety
worker -> db, libs/obs, libs/svg-safety
api -X-> worker internals
worker -X-> orders, payments, token ledger mutation
frontend -X-> api/db internals
```

- [x] TypeScript에는 dependency-cruiser, Python에는 import-linter로 위 간선을 표현한다.
- [x] 현재 위반이 있으면 freeze store를 커밋하고 신규 간선만 실패시킨다.
- [x] `apps`, `packages`, `libs`, `db` 아래 정의되지 않은 새 모듈 루트를 탐지한다.
- [x] 오류 메시지에 허용 계층과 올바른 이동 경로를 함께 출력한다.
- [ ] 의미적 중복, god module, 과도한 추상화는 자동 차단하지 않고 복수 회 코드 리뷰 대상으로 남긴다.

Phase 2 종료 조건:

- 허용 간선을 깨는 작은 fixture가 각 센서에서 의도한 교정 메시지와 함께 실패한다.
- 기존 코드가 freeze보다 악화되지 않으면 통과한다.
- false-positive 억제에는 이유가 있고, 억제 수가 공통 요약에 포함된다.

## 7. Phase 3 — 제한된 GC 조치

### 7.1 첫 조치 순서

1. unused export 한 종류만 골라 사람이 후보를 승인한다.
2. 순수 삭제 PR 하나를 만든다. 리팩터링이나 포맷 변경을 섞지 않는다.
3. 관련 build, typecheck, test와 모든 센서를 다시 실행한다.
4. merge 뒤 정기 실행에서 감소와 신규 회귀 0을 확인한다.
5. 다음 실행에서만 unused file 또는 중복 통합으로 범위를 넓힌다.

React Doctor 오류 수정도 규칙별 별도 PR로 처리한다. 예를 들어 ref 렌더 변경, object URL 누수,
effect dependency를 한 PR에 묶지 않는다.

### 7.2 PR 정책

- 초기 실행당 최대 PR은 1개다. 되돌림 없이 반복 성공한 뒤 최대 3개까지 늘릴 수 있다.
- PR은 단일 관심사·단일 파일군을 원칙으로 하고 삭제와 리팩터링을 분리한다.
- 라벨은 `gc`, `automated`, 드리프트 유형을 사용한다.
- 판단이 필요하거나 수정·검증이 두 번 실패하면 사람에게 반환한다.
- 자동머지는 사용하지 않는다. 이후에도 순수 삭제/기계 변환, 전체 센서 통과, 단일 revert 가능,
  짧은 리뷰라는 조건이 모두 검증된 경우에만 별도 승인으로 도입한다.

### 7.3 후속 파일럿

- [ ] 돈·인가·결정론 모듈 중 변경된 파일 하나를 골라 뮤테이션 테스트 비용과 유효성을 측정한다.
- [ ] 구문 중복 결과에서 목적까지 같은 후보만 수동 모듈성 리뷰로 넘긴다.
- [ ] 첫 수동 GC PR의 오탐·리버트·리뷰 시간을 기록한 뒤에만 doc-gardening 또는 dead-code 수확 자동화를 설계한다.

## 8. 운영과 하네스 감사

### 실행 케이던스

| 시점 | 실행 |
|---|---|
| 코딩 중 | 기존 lint/typecheck/관련 테스트 |
| PR | 기존 CI + 변경분 GC summary, 비차단 |
| 주간 | 전체 데드 코드·중복·React·문서 센서 |
| 반복 성공 뒤 | 구조 신규 위반 차단 |
| 월간 | 무발화 센서, 빈발 규칙, 억제, 실행 시간, 사용하지 않는 의존성 감사 |

### 기록할 지표

- 센서별 기준선 대비 미해결 수와 신규 유입 수
- finding 첫 탐지부터 merge까지 걸린 시간
- 데드 심볼 수, 중복 라인 비율, React Doctor error 수
- 센서 실행 시간, partial/실패 횟수, 억제 개수와 증가량
- GC PR 리뷰 시간, 자동화 여부, 리버트 수
- 파일럿을 시작한 뒤의 변경 파일 mutation score

커버리지는 테스트 실행 범위 확인에만 쓰고 테스트 효과성의 단독 지표로 쓰지 않는다.

### 조종 루프

같은 유형의 문제가 두 번 발생하면 다음 순서로 처리한다.

1. 기존 가이드가 발견 가능한지 확인한다.
2. 결정적으로 탐지 가능하면 센서와 교정 메시지를 보강한다.
3. 판단이 필요하면 짧은 가이드를 추가한다.
4. 정당한 패턴이면 이유 있는 억제로 등록한다.
5. 다음 하네스 감사에서 발화·오탐·억제 추세를 보고 규칙 유지 여부를 결정한다.

## 9. 금지 사항

- 기준선 검토 전에 `--fix`, 자동 삭제, 자동 PR 생성을 사용하지 않는다.
- 생성물·migration·fixture·공개 package export를 dead code로 자동 삭제하지 않는다.
- GC 변경과 기능 변경, 포맷 변경, 의존성 업그레이드를 한 PR에 섞지 않는다.
- React Doctor 점수나 커플링 숫자 하나만으로 리팩터링하지 않는다.
- 전체 경고를 한 번에 CI 차단으로 바꾸지 않는다.
- 실패·partial 센서를 0건 또는 개선으로 기록하지 않는다.
- 이유 없는 인라인 억제와 기준선 자동 갱신을 허용하지 않는다.
- 정기 작업이 저장소 쓰기 권한이나 외부 provider secret을 갖게 하지 않는다.
- 실행당 PR 상한과 두 번의 수정 시도 상한을 넘기지 않는다.

## 10. 실행 체크리스트

### 계측

- [x] 센서 버전·진입점·제외 경로 고정
- [x] 공통 요약 스키마와 최소 런너 구현
- [x] 두 번의 재현 실행
- [x] baseline 검토 기록과 `gc-baseline.json` 생성

### 비차단 자동화

- [x] 주간 read-only workflow와 artifact
- [x] 변경분 summary 명령
- [x] 실행 시간과 오탐 기록

### 신규 드리프트 차단

- [x] 문서의 결정적 오류 검사
- [x] TS/Python 허용 간선과 freeze store
- [x] 신규 모듈 루트 탐지
- [x] 교정 메시지 검증 fixture

### 제한된 상환

- [ ] 승인된 순수 삭제 PR 1개
- [ ] 전체 센서 재실행과 merge 후 감소 확인
- [ ] 리버트·리뷰 시간 기록
- [ ] 후속 자동화 도입 여부 결정

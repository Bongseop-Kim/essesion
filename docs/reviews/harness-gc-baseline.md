# 하네스 GC 기준선 리뷰

## 결과

Phase 0의 결정적 계측과 Phase 2의 구조 기준선을 만들었다. 센서는 리포트 전용 기준선과
신규 finding을 분리하며, 실패·부분 실행은 `unknown`으로 기록한다.

| 센서 | 고정 버전 | 기준선 | 해석 |
|---|---:|---:|---|
| Knip | 6.32.2 | 38 | unused export 15, unused type 23 |
| jscpd TS | 5.0.14 | 160 clones / 4.107% | 테스트·생성물 제외 |
| jscpd Python | 5.0.14 | 43 clones / 1.126% | 테스트·migration·script 제외 |
| React Doctor | 0.9.11 | error 8 / warning 192 | 오류만 우선 트리아지 |
| Vulture | 2.16 | 169 | confidence 60+, 프레임워크 동적 등록 제외 |
| 문서 링크·포인터 | repo-owned | 0 | 확정적 오류만 검사 |
| 모듈 루트 | repo-owned | 0 | `apps`, `packages`, `libs`, `db` allowlist |
| dependency-cruiser | 18.2.0 | 0 | 프론트·shared·proxy 허용 간선 |
| import-linter | 2.13 | 0 | API·worker·DB·공용 라이브러리 경계 |

## 재현성

같은 worktree에서 전체 센서를 두 번 실행했다. 실행 시간을 제외한 metric 값과 정렬된 finding
ID가 일치했다. finding ID는 줄 번호가 아니라 규칙·경로·심볼 또는 소스 조각을 사용하므로
주변 줄 삽입만으로 새 finding이 되지 않는다.

```bash
pnpm gc:sensors
GC_OUTPUT_DIR=.gc-artifacts/repeat pnpm gc:sensors
```

구조 규칙은 의도적으로 잘못된 TypeScript와 Python import fixture로 실패 종료와 교정 규칙을
검증했다.

```bash
pnpm gc:test
pnpm architecture:check
```

## 오탐 제어

- Knip은 Vite production config에 비밀값 대신 공개 placeholder만 전달한다.
- 생성 OpenAPI client, architecture fixture, 동적으로 실행하는 repo-owned sensor 파일은 자동 삭제
  후보에서 제외한다.
- Vulture는 FastAPI route와 Pydantic validator decorator, `model_config`, validator의 `cls`를
  동적 진입점으로 제외했다.
- Vulture의 남은 Pydantic/SQLAlchemy field와 framework callback은 삭제 승인이 아니라 검토
  후보로만 유지한다.
- jscpd는 TS/TSX와 Python을 분리해 언어 간 유사도를 만들지 않는다.

## React Doctor 오류 트리아지와 상환

오류 8건은 모두 render 중 최신 값을 ref에 복사하는 같은 패턴이었다. Concurrent render가
폐기돼도 ref 변경이 남을 수 있으므로 intentional suppression이 아니라 bug-risk로 분류했다.

| 파일 | ref 용도 | 조치 |
|---|---|---|
| admin product form | staged image cleanup용 최신 draft | commit 후 effect에서 동기화 |
| admin list URL hook | 이벤트용 최신 query | commit 후 effect에서 동기화 |
| checkout payment hook | 비동기 결제의 현재 owner 검증 | commit 후 effect에서 동기화 |
| payment confirm hook | 최신 성공·실패 callback | commit 후 effect에서 동기화 |
| ideas modal | 최신 request callback | commit 후 effect에서 동기화 |
| photo upload queue | 최신 photos·preview callback | commit 후 effect에서 동기화 |

수정 뒤 React Doctor는 error 0, warning 192가 됐다. 관련 Vitest 14개와 admin/store typecheck가
통과했다. warning은 이 변경에서 일괄 수정하지 않았다.

## agents-lint 비교 평가

`agents-lint` 0.5.0을 한 번 실행했으나 CI 센서로 채택하지 않았다.

- 저장소 밖 Claude memory를 같은 프로젝트 정본으로 스캔한다.
- 의도적으로 짧은 `CLAUDE.md` 포인터를 컨텍스트 부족으로 판정한다.
- 사용자 지침에 있는 읽기 전용 참고 저장소 경로를 저장소 기준으로 다시 해석한다.

대신 repo-owned 문서 센서가 로컬 Markdown 링크, 컨텍스트 포인터, 300줄 상한, 완료 리뷰와
중복된 plan을 결정적으로 검사한다.

## 남은 운영 gate

- 주간 workflow가 실제로 두 번 실행된 뒤 artifact 비교와 실행 시간 회귀를 확인한다.
- unused export 삭제는 별도 단일 관심사 PR에서 사람이 후보를 승인한 뒤 시작한다.
- 자동머지는 사용하지 않는다.
- 뮤테이션 테스트는 첫 수동 GC PR 검증 뒤 돈·인가·결정론 변경 파일 하나로 파일럿한다.

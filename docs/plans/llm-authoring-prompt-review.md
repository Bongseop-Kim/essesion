# LLM authoring 보안 — 실행 플랜

상태: 검토 완료, 실행 대기. essesion 워커는 단일 호출 structured authoring(분해/judge/캐스케이드
없음). OWASP LLM Top 10 2025 + Google/MS 인젝션 가이드 대조 + 코드 직접 확인으로 도출.

## 판단 기준

인젝션 blast radius가 세 겹으로 유계 → 통제 대부분 불필요:
- agentic tool 없음 → 인젝션이 행동으로 전환 불가 (과금·인가 정본은 api).
- 출력이 스키마 강제(constrained decoding + pydantic 재검) → 자유텍스트 명령 실행 불가.
- RAG 폐쇄계(`gallery-v1.json` 25개·sha256 고정·외부 유입 0) → 간접 인젝션 경로 없음.

**실질 잔여 = 자유텍스트 필드(reference `subject`/`description`/`catalog_ref`) 하류 렌더 XSS +
요청당 비용 증폭. 보안 노력은 이 둘에만 집중.**

---

## A. 유지 — 회귀 테스트로 고정 (이미 구현됨)

- **2단 검증**(`gemini.py:352,446`, `schema.py`): pydantic 재검을 유일 신뢰경계로. constrained
  decoding 성공을 이유로 건너뛰지 말 것. 재검 실패 시 프로즈 파싱 fallback 금지 — 재시도 또는 거부만.
- **최소 스키마 표면**(`schema.py`): `additional notes`/catch-all 등 열린 자유텍스트 필드 추가 금지.
- **catalog_ref fail-closed**(`compiler.py:98`): 화이트리스트 대조 유지. 경로/쿼리 조립에 직접 사용 금지.
- **SVG 살균**(`libs/svg-safety`): defusedxml + 태그/속성 화이트리스트 + `javascript:`/`data:`/외부 href
  거부 + `<!DOCTYPE>/<!ENTITY>` 사전거부 유지. 대문자·네임스페이스 속성 우회 회귀 테스트 추가.
- **text 모티프 화이트리스트 + `escape_attr`**(`text_svg.py:40`, `primitives.py:14`): LLM 문자열을 SVG
  속성/텍스트에 직접 보간하는 신규 코드는 반드시 XML 이스케이프/화이트리스트 경유.
- **최소권한 경계**(워커=생성, 과금·인가=api): 결제/과금 능력을 워커에 이식 금지. 워커 OIDC 권한을
  이미지 생성·GCS 최소 범위로.
- **반복 상한**(`gemini.py:38,43`, =4): 낮추지 말 것 (주석 근거: 2회는 실패 과다).
- **api 레이트리밋 + 쿼터**(`api/config.py:42`, `domains/design/quota.py`): DoW 정본. 워커 중복 구현
  금지. 신규 생성 엔드포인트는 기본 레이트리밋+쿼터를 템플릿으로 강제.
- **시크릿 프롬프트 비주입 + Secret Manager, 코퍼스 sha256 핀, uv.lock**: 유지.
- **defense-in-depth (load-bearing 아님, 유지)**: RAG "지시로 취급 금지" 라벨(`gemini.py:207`),
  user_prompt `json.dumps` 래핑(`gemini.py:130`), 시스템 프롬프트 역할·출력계약·금지 명시(`gemini.py:47`).

---

## B. 버릴 것 — 재도입 트리거 전까지 재논의 금지

| 버림 | 사유 | 재도입 트리거 |
|---|---|---|
| LLM04 포이즈닝(학습/파인튜닝/임베딩) | 자체 학습 없음, 해시고정 내부 코퍼스 | 외부/사용자 콘텐츠 수집 시 |
| LLM08 벡터·임베딩 취약점 전체 | 단일 내부 코퍼스, 테넌트·민감정보 없음 | 외부 수집 또는 테넌트별 벡터 시 |
| 하이브리드 BM25+벡터(보안 목적) | 동시검색될 적대 문서 부재 | (품질 목적이면 별도 검토, 보안 아님) |
| 수집시 살균 / 숨은텍스트·비가시문자 필터 | 수집 파이프라인 없음, PR 육안검토 | 외부 문서 수집 시 |
| 출처 인증 / C2PA / 외부 attestation | 출처가 git 단일 | 제3자 데이터셋 도입 시 |
| 벡터DB 이상탐지(anomaly/drift/perplexity) | 기대집합 알려짐 → 결정적 대조로 대체(C-2) | 코퍼스가 동적/대규모일 때 |
| 입력 인젝션 분류기 / Prompt Shields | agentic·유출채널·타 리소스 접근 없음 | agentic tool·외부 데이터 접근 추가 시 |
| datamarking/spotlighting 파이프라인 | untrusted 외부 콘텐츠 없음 | 외부 문서/웹을 프롬프트 주입 시 |
| CDA/control-plane 방어 게이트 | 스키마 서버 고정, 사용자 수정 불가 | (없음) 불변식: 스키마를 사용자 입력에서 생성 금지 |
| LLM-judge / confidence 캐스케이드 / 투표 | 외부 이미지 LLM 경로 없음, 투표는 2~4 plan 다양성과 충돌 | visual_prompt→외부 이미지 LLM 경로 추가 시 |
| HITL(사람 승인) | 워커에 부작용 액션 없음 | 워커 출력이 외부 액션 트리거 시 |
| EchoLeak식 마크다운/URL 리댁션 | 모델 통제 URL 렌더 싱크 없음 | 출력을 마크다운/HTML 렌더 시 |
| 글리치 토큰 필터 | 제약 출력, agentic 없음 | 자유생성/agentic 경로 추가 시 |
| LLM09 misinformation 완화 | 출력은 미적 설계, 사실 진술 아님 | (없음) |

---

## C. 할 것 — 신규 보강

- **C-1. `maxOutputTokens` 명시** (워커, `gemini.py:358`) — `GenerateContentConfig`에 출력 토큰 상한 추가.
- **C-2. 코퍼스 무결성 대조** (워커) — 부팅/헬스체크에서 pgvector 행이 매니페스트
  `example_id`·`source_digest`·개수(25)와 일치하는지 검사, 불일치 시 기동/배포 실패.
  `load_example_set()`에 `gallery-v1.json` 전체 sha256 상수를 두고 assert. pgvector write는
  `sync_authoring_examples.py --confirm-live` 유일 경로로 봉쇄, `data/`·golden 브랜치 보호.
- **C-3. 자유텍스트 필드 프론트 XSS** (프론트) — `subject`/`description`/`catalog_ref` UI 렌더 시
  HTML 이스케이프 + CSP. 살균 SVG를 `dangerouslySetInnerHTML`로 인라인 금지, `<img>`/객체로.
  인젝션이 실제 손상으로 전환되는 유일 경로.
- **C-4. 토큰/비용 인지 쿼터 + GCP 예산 알림** (api) — 요청 수가 아니라 Gemini 토큰 + Recraft 호출
  수로 차감. GCP Billing budget 변화율 알림(2x/5x/10x), Vertex spend 한도 활성화.
- **C-5. 경량 적대적 회귀 세트** (워커) — "이전 지시 무시"·스키마 탈출·초대형/유니코드·JSON 구분자
  탈출 케이스 → 항상 유효 DesignPlanV3 또는 안전 거부를 회귀로 고정.
- **C-6. self-correction 되먹임 최소화 + 요청 데드라인** (워커) — 오류 피드백을 "필드 X가 제약 Y
  위반" 구조화 메시지로 한정, 사용자 원문 에코 최소화. 요청당 wall-clock 데드라인 추가.
- **C-7. 검색 추적성 로깅** (워커) — 선택된 `example_id` + 매니페스트 버전 기록. PII·원문 보존 최소화.
- **C-8. Vertex 콘텐츠 safety filter 구성** (설정) — 유해 디자인 요청 차단 + 남용 모니터링.
  콘텐츠 남용 방어 목적이며 인젝션 방어 아님(인젝션은 스키마 계약이 담당).

---

## D. 순서

1. **A를 회귀 테스트로 고정** — 특히 svg-safety 우회 회귀, "재검 실패 시 프로즈 fallback 금지" 불변식.
2. **C-1·C-2·C-5·C-6** (워커 내 값싼 보강).
3. **C-3**(프론트)·**C-4**(api)를 각 서비스 백로그로 이관.
4. **C-7·C-8** 여력 될 때.
5. **B는 트리거가 오기 전까지 다시 논의하지 않는다.**

---

## 근거 출처

- OWASP Top 10 for LLM Applications 2025 — <https://genai.owasp.org/resource/owasp-top-10-for-llm-applications-2025/>
- Google, Mitigating prompt injection — <https://blog.google/security/mitigating-prompt-injection-attacks/>
- Microsoft MSRC, spotlighting (2025) — <https://www.microsoft.com/en-us/msrc/blog/2025/07/how-microsoft-defends-against-indirect-prompt-injection-attacks>
- Constrained Decoding Attack (CDA) — <https://arxiv.org/abs/2503.24191>
- SVG XSS 살균 — <https://www.svggenie.com/blog/svg-xss-sanitize-guide>
- Denial of Wallet / cost-aware rate limiting — <https://handsonarchitects.com/blog/2025/denial-of-wallet-cost-aware-rate-limiting-part-1/>

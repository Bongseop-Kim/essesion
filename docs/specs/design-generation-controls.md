# Design generation controls

`/design` 작성창에서 선택한 값이 Store의 prompt 문자열에 섞이지 않고 API와 worker의
구조화된 계약으로 전달되는 경계를 기록한다. 구현의 최종 권위는 OpenAPI와 worker
Pydantic 모델이며, 이 문서는 두 경계가 의도한 의미와 보안 정책을 설명한다.

## 생성 요청

prompt 생성 요청은 다음 상태를 함께 보낸다.

```json
{
  "reference_images": [
    {"upload_id": "uuid", "purpose": "color_mood"}
  ],
  "user_motif_ids": ["uuid"],
  "palette": {
    "mode": "fixed",
    "colors": ["#10243A", "#EFE6D4", "#C04A3A"]
  },
  "pattern_constraints": {
    "motif_scale": "small",
    "density": "dense",
    "arrangement": "staggered",
    "direction": "diagonal"
  },
  "candidate_count": 4
}
```

- 참고 사진은 최대 5장이고 `purpose`는 `auto`, `color_mood`, `motif`,
  `composition` 중 하나다. 배열 순서와 purpose는 API, Gemini image part,
  `seamless_generation_attachments`, `design_turn_attachments`까지 보존한다.
- 명시한 사진 purpose는 해당 역할에만 사용한다. `auto`만 prompt 문맥에 따라 역할을
  추론한다.
- 사용자 모티프는 최대 2개이며 현재 소유자의 `UserMotif` 링크 또는 같은 소유자·같은
  세션의 과거 SVG 첨부 이력으로만 exact motif ID를 해석한다. 후자는 라이브러리에서
  삭제한 뒤에도 기존 variation/finalize를 보존하기 위한 범위이며 다른 사용자나 다른
  세션의 ID는 직접 intent에 넣어도 거부한다.
- fixed palette는 서로 다른 2~5개의 HEX 색만 받는다. `#RGB`는 `#RRGGBB`로 확장하고
  대문자로 정규화하며 입력 순서를 유지해 중복을 제거한다.
- pattern의 각 항목은 `auto`로 개별 복귀할 수 있다. 지원하지 않는 엔진 표현으로
  조용히 fallback하지 않는다.
- 정규화된 palette와 pattern 설정은 user `generate_request` turn payload에 기록한다.

성공한 생성은 참고 사진을 staging에서 one-shot 사용 완료 상태로 옮긴다. 실패한 생성은
트랜잭션 rollback과 토큰 환불 뒤 같은 staging upload ID로 재시도할 수 있다. 사진을 쓰는
요청에는 이력과 만료의 소유자가 되는 design session이 반드시 필요하다.

일반 prompt 생성이 성공하면 요청에 실제 사용한 prompt, 참고 사진과 purpose,
선택 모티프, palette, pattern, 후보 수를 작성창에서 초기화한다. 생성이 실패하면
이 전체를 유지한다. `다시 만들기` variation은 선택한 기존 resolved intent의 reroll이며,
작성 중인 prompt·참고 사진·exact 모티프를 전송하거나 소비하지 않는다. variation에
적용된 후보 수·palette·pattern만 성공 후 기본값으로 돌리고, 실패 시에는 모든
작성 상태를 유지한다. 새 세션을 시작하거나 다른 세션을 선택할 때는 임시 작성 상태를
정리하되 내 모티프 라이브러리는 유지한다.

## 작성창 UI

`+` 패널의 최종 액션 순서는 사진 첨부, 모티프 추가, 내 모티프, 색상, 패턴 설정,
후보 수, 내 세션, 내 완성본, 새로 만들기, 충전이다. 모바일은 4열, 데스크톱은
5열×2행으로 배치하며 마지막 모바일 행의 2개 액션은 가운데에 둔다. 아이디어는 이
패널에 넣지 않고 prompt 입력창 안의 Sparkles 보조 액션으로만 연다.

사진 purpose는 사진 카드에 현재 값을 표시하고 삭제 버튼과 분리된 anchor Menu로
바꾼다. 색상·패턴·아이디어는 각각 `ResponsiveModal`, 모티프 추가는 하나의
`ResponsiveModal` 안에서 SVG 파일·텍스트/이니셜·사진 탭을 전환한다. 확인 대화상자가
필요한 삭제 흐름은 기존 modal을 닫은 뒤 열어 동시에 열린 modal이 하나를 넘지 않는다.
모든 Menu·tab·radio·dialog는 키보드 이동, Escape 닫기, trigger focus 복귀와 접근 가능한
이름을 유지한다.

## 색상과 패턴의 엔진 변환

기존 intent의 `palette.slots`와 모든 slot을 덮는 `colorways.default.mapping` 계약은
유지한다. fixed palette 요청은 사용 중인 slot이 요청 색 수 이상인 intent만 허용한 뒤,
slot과 default colorway를 입력 순서대로 결정적으로 다시 매핑한다. 요청 색이 실제 layer가
참조하는 slot에 모두 나타나는지 candidate 생성 전후에 검사한다. fixed palette에서는
다른 colorway를 선택하거나 후보의 colorway 축을 확장하지 않는다.

| 사용자 설정 | 엔진 표현 |
|---|---|
| 작게 / 보통 / 크게 | tile 대비 고정 `size_mm` 비율 |
| 여유롭게 / 보통 / 촘촘하게 | lattice cell, Poisson count/min distance, path spacing |
| 격자 | drop이 없는 `lattice` |
| 엇갈림 | `lattice` + column half-drop (`drop_fraction=1/2`) |
| 흩뿌림 | seeded Poisson `scatter` |
| 수평 / 수직 / 대각선 | stripe angle과 motif placement의 고정 rotation |

고정 rotation은 optional placement 필드다. 값이 없는 기존 intent의 canonical layout JSON과
SVG에는 변화가 없어 기존 intent+seed의 byte-identical 계약을 보존한다. 명시한 축은
candidate layout variation에서 잠그고, 생성된 모든 candidate에 제약을 다시 검증한다.
조건을 만족하는 intent를 Gemini가 작성하지 못하면 한 번의 constrained retry 뒤 422를
반환한다.

## 모티프 추가

세 입력 방식은 모두 private worker의 동일한 sanitize·normalize 경계를 통과한다. 텍스트와
사진은 저장 전에 standalone SVG preview를 받고, 원본 SVG는 안전 처리 전 브라우저에서
렌더하지 않은 채 저장 요청에서 정규화 결과를 받는다.

```text
SVG 파일 / 텍스트 / 사진
  -> byte·형식·복잡도 검증
  -> worker SVG sanitize + normalize + geometry content hash
  -> API owner advisory lock
  -> API가 Motif(source=user_upload) + 소유자 UserMotif 링크 원자 저장
```

동일 geometry는 같은 motif ID가 되고 사용자별 링크 생성은 idempotent하다. 한 계정의
라이브러리는 최대 100개다. `user_upload` source는 일반 retrieval, embedding 후보,
registry fingerprint에서 제외하며 위 소유권 경계를 통과한 exact ID만 생성에 사용할 수
있다. worker `/motifs/import`는 DB write를 하지 않고 정규화 SVG와 identity만 반환한다.
API가 라이브러리 상한 검사와 motif/link insert를 같은 트랜잭션으로 처리하므로 quota 실패가
owner 없는 motif를 남기지 않는다. 공개·생성 motif catalog의 검색/upsert는 worker resolver가
계속 소유하며 private 사용자 라이브러리와 분리한다. 라이브러리 링크를 삭제해도 과거 turn
attachment와 생성 결과의 motif 행은 유지한다.

### 텍스트

- worker가 번들된 Nanum Gothic/Myeongjo Regular/Bold를 읽고 FontTools로 glyph outline을
  path로 변환한다. 브라우저나 호스트의 시스템 font를 사용하지 않는다.
- 입력은 NFC로 정규화한 짧은 한글·ASCII 영문·숫자·공백만 허용한다. 지원하지 않는 glyph는
  대체 글자로 바꾸지 않고 오류로 반환한다.
- 최종 SVG에는 `<text>`, script, 외부 font URL, 외부 href가 남지 않는다.
- 같은 text, font ID, weight, letter spacing은 같은 normalized SVG와 motif ID를 만든다.
- 폰트 원본과 OFL 라이선스는 `apps/worker/src/worker/motifs/fonts/`에 함께 둔다.

### 사진

- 입력은 기존 private `design_reference_upload`만 사용하므로 소유권, JPEG/PNG/WebP 실제
  MIME, 10MB, 20M pixel, signed URL allowlist와 redirect 차단을 그대로 재사용한다.
- 새 유료 provider나 이미지 외부 전송 없이 Pillow로 방향 보정·축소·색상 quantize를 하고,
  선택 시 가장자리와 연결된 배경을 결정적으로 제거한 뒤 CPU VTracer로 SVG를 만든다.
- 이 자동 분리는 평면적이고 윤곽이 분명한 피사체를 위한 경량 경계다. 분리 신뢰도가 낮거나
  결과가 비었으면 원본 포함 모드로 몰래 바꾸지 않고 안내와 재처리 선택을 반환한다.
- 색상 수, SVG byte, XML node, path, path command에 상한을 적용하고 CPU 작업은 threadpool에서
  실행한다. preview를 취소하거나 실패해도 원본 staging 사진은 TTL 뒤 정리되며 라이브러리에는
  import된 최종 SVG만 영구적으로 남는다.

Nanum 글꼴은 SIL Open Font License 1.1, FontTools와 VTracer는 MIT 라이선스다. 정확한
버전은 `uv.lock`, 배포 asset은 동봉된 라이선스 파일이 권위다.

## Palette extraction과 ideas

`POST /design/palette/extract`는 소유자의 staging 참고 사진을 worker에서 결정적으로 축소·
quantize해 2~5개의 정규화된 HEX를 반환한다. 결과는 별도 palette 레코드로 저장하지 않고
현재 fixed palette draft에 적용한다. 이름 붙인 저장 palette는 현재 owner table, 수명주기,
인가·이력 의미가 없고 핵심 생성에 필요하지 않다. 이를 위해 새 DB CRUD 도메인과 임의의 저장
개수 제한을 만들지 않고, 이름·공유·재사용 요구가 확정될 때 별도 도메인으로 이연한다.

`POST /design/ideas`는 현재 prompt, ordered reference purpose, 선택한 user motif 이름과 exact
ID, palette, pattern을 private worker에 전달한다. API와 private worker 경계에서는 exact
ID를 검증·보존하지만, Gemini prompt에는 content-hash ID를 노출하지 않고 순번과 사용자가
지정한 이름만 전달한다. worker의 기존 Gemini provider가 3~4개의 짧은 문장을 반환하며 이
helper는 디자인 토큰을 차감하거나 session turn, intent, generation log를 쓰지
않는다. API의 인증 사용자 ID 키를 기준으로 각 프로세스에서 60초당 6회를 제한하며 worker는
외부에 공개하지 않는다. 이 메모리 제한은 Cloud Run 전체의 전역 quota를 보증하지 않으므로,
프로덕션 Cloudflare에 `/design/ideas` IP rate limit과 WAF를 추가해 방어 층을 둔다. 이 두
제한은 무과금 helper의 abuse 방어이며 정확한 전역 과금 quota로 해석하지 않는다. Store는
아이디어 적용과 디자인 생성을 분리하고, 기존 prompt가 있으면 교체 또는 뒤에 추가를
명시적으로 선택하게 한다.

## 외부 이미지 처리 경계

생성과 아이디어 helper에 첨부한 참고 사진은 worker가 서명 URL에서 읽은 뒤 방향을
보정하고 축소·재인코딩해 메타데이터를 제거한 바이트를 Gemini image part로 전송한다.
private GCS URL 자체를 provider에 넘기지는 않지만 이미지 내용은 외부 processor 경계를 넘는다.
사진에서 SVG 모티프를 만드는 배경 분리·vectorize 경로는 Gemini를 호출하지 않고 로컬
Pillow+VTracer CPU 경계에서만 처리한다.

프로덕션에서 Gemini credential을 활성화하기 전에 privacy owner는 실제 계약과 프로젝트
설정을 기준으로 처리 지역, 학습 사용 여부, 로그·abuse monitoring 보존, 삭제 제어,
DPA와 사용자 고지를 승인해야 한다. 승인되지 않은 provider 보존 기간이나 학습 제외를
시스템 보장으로 미리 기술하지 않는다.

## 제한값

| 항목 | 제한 |
|---|---:|
| 참고 사진 | 생성당 5장 |
| 참고 사진 byte | 장당 10MB, 합계 50MB |
| 참고 사진 decoded pixel | 장당 20,000,000 |
| 생성 exact motif | 총 2개 |
| 사용자 motif library | 계정당 100개 |
| SVG 입력/결과 | 2MB |
| SVG XML | node 2,048개, depth 64 |
| SVG path | 1,024개, command 50,000개, geometry token 200,000개 |
| 텍스트 motif | 20자, path command 20,000개 |
| 사진 vectorize | 최대 변 1,024px, 결과 1~6색 |
| fixed palette | 서로 다른 2~5색 |
| idea 결과 | 3~4개, 문장당 180자 |

사진·모티프 개수, byte, palette, 텍스트 길이처럼 사용자에게 노출되는 공통 제한은 각
경계에서 같은 값으로 검증한다. SVG node·depth·path·geometry 같은 내부 구조 상한은 최종
sanitize·normalize 소유자인 worker가 강제한다.

# 모티프 생성 어댑터 파일럿 — Recraft vs GPT Image 2 + VTracer

> 결정: Recraft 벡터 생성(시도당 $0.08)을 GPT Image 2 low(시도당 $0.006) +
> 로컬 VTracer 벡터화로 교체할 수 있는지 **데이터로** 판정한다. 근거 논쟁은
> 끝났고(비용 13×, 프롬프트 이해력 우위 vs 트레이스 품질 리스크), 남은 쟁점은
> 전부 경험적이다 — 어댑터 하나 + 비교 스크립트로 파일럿을 돌리고, 판정 기준을
> 통과하면 별도 플랜으로 전환을 실행한다.
>
> 이 플랜 자체는 **제품 동작을 바꾸지 않는다.** 런타임 생성 경로·과금·스키마
> 무수정. 산출물은 새 어댑터 모듈 1개, 비교 스크립트 1개, 판정 결과 기록이다.

## 배경 (판단 요약)

- 모티프는 로고급 소형 평탄색 도형이다. 48mm 타일 300dpi ≈ 570px라 1024px
  래스터 소스의 디테일 상한은 실질 병목이 아니다.
- 재시도 경제학이 단가 차이를 증폭한다: 게이트 실패 시 재프롬프트 루프가
  시도당 $0.08 vs $0.006. 색 도수 제약은 과거 품질만 떨어뜨려 제거한 이력이
  있음 — 프롬프트로 스타일을 강제하지 않고 후처리(양자화)로 평탄화한다.
- raster→vector 파이프라인은 이미 있다: `motifs/photo_svg.py`가 VTracer +
  양자화 + 정규화 예산(`MAX_MOTIF_NODES/PATHS/PATH_COMMANDS/SVG_BYTES`)을
  갖추고 사진 벡터화에 쓰고 있다. 어댑터는 이걸 재사용한다.
- 살아남은 리스크 = **획(stroke) 기반 모티프**. VTracer는 stroke 개념이 없어
  가는 선이 이중 윤곽 채움 도형이 되고 노드 수가 튄다. 프롬프트 세트에 이
  유형을 반드시 포함해 실패 모드를 확인한다.

## 1. 어댑터 — `apps/worker/src/worker/adapters/gpt_image.py`

`recraft.generate_motif(spec, *, client, settings, seed)` → `NormalizedMotif`와
같은 시그니처·재프롬프트 구조(최초 + 게이트 실패 재생성 1회)를 따른다.
등록은 호출자 소관 — 어댑터는 DB를 모른다.

- **호출**: OpenAI Images API, `model="gpt-image-2"`, `quality="low"`,
  `size="1024x1024"`, `background="transparent"`, `n=1`, b64 PNG 수신.
  클라이언트 구성은 `adapters/llm.py`·`embedding.py`의 기존 OpenAI 패턴을
  따르고 `openai_api_key`/`openai_base_url` 설정을 재사용한다. seed 파라미터는
  없음 — authoring-time 1회 생성 + content-hash 저장이라 결정론 계약과 무관
  (Recraft와 같은 지위).
- **프롬프트**: `_build_recraft_prompt`의 본문 제약(단일 오브젝트, 평탄색 면,
  no gradient/text/pattern/background)을 GPT용으로 개작. 색 개수 제약은 걸지
  않는다 — 평탄화는 후처리 양자화가 담당.
- **벡터화 파이프라인** (photo_svg 재사용, 필요한 내부 함수는 공개로 승격):
  1. PNG decode → RGBA, 알파 임계 이진화(반투명 AA 엣지를 배경으로 확정 —
     구현 시 `_quantize`의 알파 처리 확인).
  2. `_quantize(image, color_count)` — 기본 6색. AA 후광 레이어를 여기서 접는다.
  3. `vtracer.convert_pixels_to_svg(...)` — `_SIMPLIFICATION` 프리셋으로 시작,
     파일럿에서 low/medium 비교.
  4. `_canonicalize_vtracer_svg` → `normalize_motif_svg` — **기존 게이트를
     그대로 통과시킨다.** 게이트를 어댑터에 맞춰 완화하지 않는다(비교가
     무효가 된다).
- Recraft 어댑터는 무수정. 이 단계에서 resolver·routes 배선도 하지 않는다.

## 2. 비교 스크립트 — `apps/worker/scripts/eval_motif_adapters.py`

유료 호출이므로 `--confirm-live` 필수(하우스 패턴: `index_motif_embeddings.py`).

- **프롬프트 세트** (~20건, 스크립트에 인라인):
  - 실사용 유형: 페이즐리, 플로럴, 동백꽃, 기하 문양, 동물 실루엣 등 카탈로그
    시드(`seed_motifs.py`)와 겹치는 주제 위주.
  - 획 기반 5건 이상: line-art 잎사귀, 한 붓 그리기 새, 가는 윤곽선 도형 —
    리스크 유형을 의도적으로 때린다.
- **실행**: 프롬프트 × {recraft, gpt_image} 각 1회(재프롬프트 포함 최대 2시도).
  기록 항목:
  - 게이트 통과 여부·시도 횟수(= 실질 단가), 실패 시 게이트 오류 원문
  - path/node/command 수, SVG bytes (예산 대비 여유)
  - 호출 경과 시간
- **산출물**: `scratch` 디렉터리에 SVG + 렌더 PNG 저장, 요약 표(stdout) +
  나란히 보는 HTML 갤러리 1장(미감은 사람이 판정).
- 예상 비용: 20 × ($0.006 + $0.08) × ≤2시도 ≈ **$2~3.5**.

## 3. 판정 기준 (통과 = 전환 플랜 착수)

1. **게이트 통과율**: gpt_image가 2시도 내 성공률에서 recraft와 대등 이상.
2. **예산 여유**: 통과 SVG의 node/path가 `MAX_MOTIF_*` 상한의 ~70% 이내
   (여유 없이 턱걸이면 프롬프트 분포가 조금만 바뀌어도 실패율이 튄다).
3. **미감**: HTML 갤러리를 사람이 보고 판정 — 동률이면 비용이 이긴다.
4. **획 기반 유형**: 전멸이면 "획 기반 주제는 지원 밖" 명세로 수용 가능한지
   별도 판단(전환 블로커는 아니되 명세·안내 문구에 반영).

결과는 통과/탈락 관계없이 `docs/reviews/`에 기록하고 이 플랜을 plans에서
제거한다(하우스 규칙).

## 4. 전환 (통과 시 — 별도 플랜으로)

파일럿 통과 후에만 작성·실행. 미리 정해두는 방향만 요약:

- `Settings`에 어댑터 선택 키 추가, `resolver.resolve_spec`의 recraft 주입부를
  선택 어댑터로 교체. Recraft 어댑터·설정은 폴백으로 유지할지 삭제할지 그때 결정.
- `motifs.source` 값(`"recraft"`), 예산 키 `design_recraft_budget` 등
  recraft 고유 명칭의 개명 여부 — admin_settings·DB 값이라 마이그레이션 포함.
- `docs/api-spec/worker-motifs.md`·`ARCHITECTURE.md`의 Recraft 명세 갱신.

## 하지 않는 것

- 런타임 generate 경로·과금·store UI 수정 — 파일럿은 스크립트로만 돈다.
- 게이트·정규화 예산 완화 — 기준선을 움직이면 비교가 무의미하다.
- DB 등록 — 파일럿 산출물은 파일로만 남긴다(`pending` 오염 금지).

# 참고 사진 역할 격리 (purpose=color_mood / composition)

> `docs/reviews/design-input-modality-e2e-2026-07-30.md` S1-2에서 분리. 프롬프트
> 문구로는 고쳐지지 않음을 실측으로 확인했으므로 구조적 수정이 필요하다.

## 문제

`purpose=color_mood`는 "팔레트·질감 인상·분위기만 사용"이라는 **구속력 있는 역할**로
프롬프트에 들어가지만, 모델은 사진 속 형태를 모티프 subject로 그대로 가져온다.

실측(녹색 바탕 + 실버 사선 + 네이비 테니스 크레스트 사진, 프롬프트
"작은 마름모를 규칙적으로 반복한 패턴"):

| 조건 | 사진 형태 누출 |
|---|---|
| 금지 문구 추가 | 4/4 (`tennis racket and shield`, `shield with crossed tennis rackets`) |
| 금지 문구 없음 | 3/4 (한 번만 `small rhombus`) |

문구를 넣은 쪽이 더 나쁘다 — 금지 문장에 형태 어휘가 들어가면 오히려 프라이밍된다.
사용자가 명시한 "마름모"는 대부분 사라지고, 사선 구도까지 복제된다.

`composition`도 같은 구조적 노출이 있다(S1-4에서는 색·모티프가 프롬프트대로
유지돼 문제로 드러나지 않았지만, 같은 이유로 보장되지 않는다).

## 원인

`_build_prompt`가 역할을 **문장으로만** 전달하고, 이미지 파트는 역할과 무관하게
항상 그대로 모델에 첨부된다(`_generate_response`가 `reference_images` 전량을
`Part.from_bytes`로 넣는다). 모델이 형태를 볼 수 있는 한 형태를 쓰지 않도록
설득하는 데 실패한다.

이는 정확히 같은 계열의 문제를 서빙 스키마에서 변형을 빼는 방식으로 해결한
`_servable_json_schema(..., without=[...])`(같은 리뷰 §결함 3)과 대칭이다:
**능력을 제거하는 것이 금지하는 것보다 확실하다.**

## 제안

`purpose=color_mood` 이미지는 모델에 보내지 않는다. 대신 서버가 결정론적으로
팔레트를 뽑아 색 정보만 프롬프트로 전달한다.

- 추출은 이미 있는 `worker/motifs/photo_svg.py:extract_palette(data, type, count)`를
  재사용한다(대표 색상 추출 기능과 같은 함수).
- `composition`은 공간 리듬이 필요해 이미지를 대체할 값이 없다. 1차 범위에서는
  `color_mood`만 다루고 `composition`은 현행 유지 + 리뷰 문서에 한계로 남긴다.

### 결정이 필요한 지점 (구현 전 확인)

1. 추출한 색을 **fixed 팔레트로 강제**할지, **제안**으로만 넘길지.
   - fixed로 강제하면 역할이 확실해지지만, 같은 리뷰 F2(5색 fixed + 사진 =
     가시성 계약 0/4 실패)와 정면으로 충돌한다. 색 수를 3 이하로 제한하는 게
     사실상 전제 조건이다.
   - 제안으로 넘기면 실패 위험은 없지만 "팔레트만 쓴다"는 구속력이 다시 약해진다.
2. 사용자에게 무엇을 보여줄지 — 추출된 색을 턴 이력에 표시하면 "이 사진에서 이
   색을 읽었어요"가 되어 U8(자동 판단 결과 미노출)도 함께 개선된다.

## 구현 개요

- `ReferenceImage`에 모델 전송 여부와 추출 색을 담을 필드를 추가한다(예:
  `send_to_model: bool`, `colors: tuple[str, ...]`).
- `worker/api/routes.py:_load_reference_image_items`에서 `purpose == "color_mood"`인
  항목은 `extract_palette`를 돌리고 이미지 바이트는 모델 입력에서 제외한다.
- `_generate_response`의 이미지 파트 조립과 `_build_prompt`의 이미지 번호 부여를
  **실제로 전송되는 이미지만** 대상으로 바꾼다. `reference_image_index`가
  1-based로 전송 순서를 가리키므로, 번호가 어긋나면 `purpose=motif` 사진 선언이
  깨진다 — 이 부분이 가장 조심할 지점이다.
- `_build_prompt`에 추출 색을 넘기는 줄을 추가한다(팔레트 제약과 별개 문구로,
  1의 결정에 따라 fixed 제약으로 승격 여부가 갈린다).
- `suggest_ideas`도 같은 이미지 목록을 쓰므로 함께 확인한다.

## 검증

- [ ] 1의 결정을 사용자에게 확인
- [ ] `purpose=color_mood` 1장 + 형태를 명시한 프롬프트로 직접 호출 8표본 —
      사진 속 형태 누출 0건, 사용자가 말한 형태가 subject로 채택
- [ ] `purpose=motif`와 `color_mood`를 섞은 요청에서 `reference_image_index`가
      여전히 올바른 이미지를 가리킴(번호 재부여 회귀)
- [ ] 추출 실패(단색 이미지 등) 시 요청 전체가 죽지 않고 색 정보 없이 진행
- [ ] `uv run pytest apps/worker/tests/` · ruff · pyright
- [ ] Aside로 S1-2 재실행 — 팔레트 근접 + 형태·구도 미유입

## 상태 — 계획

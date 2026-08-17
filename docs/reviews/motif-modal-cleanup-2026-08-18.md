# 모티프 모달 정리 + 사진 거절 사유 복원 — 2026-08-18

## 사진 첨부가 `worker_rejected`로 실패한 건 결함 F9였다

`design-input-modality-e2e-2026-07-30.md`의 **F9**("워커 거부 사유가 api에서 버려져 사진·SVG
실패가 '이미지 워커가 요청을 거부했습니다' 하나로 뭉개진다")가 그대로 남아 있었다. 실제 사진은
평면 배경 분리가 불가능해 워커가 422를 내는데, 사용자는 무엇을 바꿔야 하는지 알 수 없었다.

재현(로컬, 워커 직접 호출):

| 요청 | 워커 detail |
| --- | --- |
| `remove_background=true` | `background confidence 0.42 is too low` |
| `remove_background=false` | `vectorized SVG exceeds 2000000 bytes` |

둘 다 **사용자가 다른 사진으로 고칠 수 있는 조건**인데 api가 코드 없이 뭉갰다.

- 워커: `PhotoInputError(ValueError)`에 `code`를 실어 `422 {detail:{code,message}}`로 낸다.
  `ValueError` 하위라 다른 `except ValueError` 경계는 그대로다. 코드는
  `photo_background_unclear`(confidence 미달·빈 피사체·프레임 충전)와
  `photo_too_detailed`(SVG 바이트·node·path·path command 상한).
- api: `_post`가 `/generate`와 함께 `/motifs/photo-preview`도 `_worker_rejection`으로 보낸다.
  코드→문구 맵 2개를 `_WORKER_REJECTIONS` 하나(`code → (문구, stage)`)로 합쳤다. 사진 코드는
  stage가 없다. 영문 진단은 여전히 고객에게 노출하지 않는다.
- 코드 없는 422(디코드 실패 등)는 예전처럼 일반 `worker_rejected`.

store는 손대지 않았다 — `designErrorMessage`가 이미 api `detail`을 그대로 보여준다.

## F8도 같이 닫았다

성공 화면에 `automatic separation is limited to flat border-connected backgrounds`가 영문으로
떠 있었다(2026-07-30 기록, 미해결). 경고를 지웠다 — 분리 한계는 실패 시 code가 말하고, 성공
화면은 바로 위 한글 캡션("배경을 지우고 가까운 중간색을 정리했어요")이 이미 같은 내용을 말한다.

## 모달 정리 (글자 넣기 · 사진에서 따오기)

- 헤더 설명 제거: 탐색·AI 생성·글자 넣기·사진에서 따오기. 남은 건 내 모티프 하나다.
- "추가 비용 없이 몇 번이든" 제거 — 글자 필드 설명은 글자 수 카운터만 남는다.
- **액션을 푸터 CTA로 옮겼다.** 결과 전 CTA 하나 → 결과 후 좌측 보조 + `이 그림 적용`:
  - 글자: `이 글자로 만들기` → `이전` + `이 그림 적용`. `이전`은 결과만 버리고 입력으로
    되돌린다. 사진 모달의 `취소`는 모달을 닫는 동작이라 같은 라벨을 쓰지 않았고, 글꼴·굵기는
    바꾸는 즉시 자동 재렌더라 "다시 만들기"도 맞지 않는다.
  - 사진: `사진 고르기`/`다른 사진 고르기`(실패 후) → `다른 사진` + `이 그림 적용`. 입력이
    파일 선택창이라 좌측 버튼은 "입력 수정"에 해당한다. hidden input이 푸터로 옮겨갔다.
- 곁들여 고친 버그: 글자를 고쳐도 `textResult`가 남아 `적용`이 낡은 SVG를 넣었다. 필드 안
  만들기 버튼이 있을 때는 다시 눌러야 갱신되는 게 보였지만, 버튼을 없애면 조용한 오적용이 된다.
  `setText`가 결과를 비워 CTA가 스스로 `만들기`로 되돌아온다.

## 결정: 배경 유지 없음 + 고르기 전 안내

`remove_background=false`도 사진 같은 입력에서는 `photo_too_detailed`로 막혀 켜 둘 수 있는
경로가 아니었다. 배경이 남은 모티프는 넥타이 패턴이 될 수도 없다. **옵션을 삭제했다** —
worker `photo_to_svg`·`PhotoMotifPreviewRequest`, api 요청 스키마, store `previewPhotoMotif`,
api-client 재생성까지. 이제 요청은 `{image}`뿐이다.

대신 **고르기 전에** 되는 사진을 말한다. 그러려면 플로우를 바꿔야 했다: 기존에는 슬롯 메뉴의
"사진에서 따오기"가 **파일 선택창을 먼저** 열고 변환이 끝난 뒤에야 모달이 떴다 — 안내를 넣을
자리가 없었다(넣어도 `!photo` 상태가 오지 않아 죽은 UI였다). 지금은 메뉴가 모달을 먼저 열고
`PHOTO_TIPS` 4줄 + `사진 고르기` CTA를 보여준다. 파일 입력이 MotifPanel에서 사라져 모달 푸터
한 곳에만 남았다(중복 input 제거).

  배경이 흰색처럼 한 가지 색인 사진 / 그림 하나만 가운데 있고 테두리까지 배경이 이어진 사진 /
  형태가 또렷하고 색이 적은 것 — 로고·자수·아이콘 / 풍경·인물 사진은 배경을 지울 수 없어요

## 검증

- 브라우저(Aside, store :3000): 글자 모달 2단 CTA, 사진 성공(`다른 사진`+`이 그림 적용`,
  영문 경고 없음), 사진 실패(한글 사유 + `다른 사진 고르기`). 콘솔 오류 없음.
  **모달 우선 플로우와 `PHOTO_TIPS`는 브라우저로 못 봤다** — 세션이 탭·리로드를 넘기지 않아
  재로그인이 붙지 않았다. 이 두 가지는 jsdom 테스트로만 검증했다.
- api 직접 호출로 성공·실패 왕복 확인(`photo_background_unclear` → 한글 detail).
- 새 테스트: 워커 `photo_preview_rejection_carries_a_code_for_the_api`,
  `photo_vectorization_fails_closed_when_the_subject_fills_the_frame`, api
  `worker_client_maps_photo_rejection_codes_to_actionable_messages`, store 글자 CTA 전환 +
  "사진에서 따오기는 파일 선택창보다 모달을 먼저 열어 되는 사진을 안내한다".
- `ruff`·`pyright`·`biome`·`typecheck`·`architecture:check`, 워커+design 626 passed,
  store 224 passed, `pnpm codegen` 재생성.

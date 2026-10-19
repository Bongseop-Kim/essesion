# worker 명세 2/3 — 모티프 시스템

모티프 정규화·content-hash는 동작 명세의 일부 — 임의로 바꾸지 말 것. 저장은 `motifs` 테이블 한 종류다.

> 개정 2026-10-19: AI 디자인 제거로 GPT Image 생성·임베딩·catalog grounding·LLM 저작·텍스트 모티프·아이디어
> 계약(옛 §3~§7·§7.2)을 지웠다. 남은 유입은 시드, 사용자 SVG import, 사진→SVG다. 절 번호는 코드 참조를 지키려고 그대로 둔다.

## 1. 모티프 데이터 모델·정규화

`MotifDef{id, symbol, bbox_mm, anchor}`:
- symbol = `<symbol id="motif-{id}" overflow="visible">{geometry}</symbol>` — **viewBox 없음**(use transform이 mm 1:1). geometry는 `<g transform="translate(tx ty) scale(s)">…</g>` 래핑 1개.
- 정규화된 모티프는 항상 bbox `(-0.5,-0.5,0.5,0.5)`, anchor `(0,0)` — tight bbox의 중심을 원점, 긴 변을 1.0으로: `scale=1/extent, tx=-(bx+bw/2)·scale, ty=-(by+bh/2)·scale`.
- 거부: extent≤0, 0폭 축, `extent/min_side > 20.0`(aspect 상한), viewBox/치수 없음, drawable 없음(defs 밖 path/polygon/…), filter/raster image/외부 href(화이트리스트 밖).
- symbol의 fill/stroke는 생성·업로드 시 확정된 concrete paint다. 이후 디자인 palette나 구성 patch가 이를 바꾸지 않는다.
- `ingested_user_id`·`ingested_session_id`는 최초 유입 감사 provenance다. content-hash conflict는 이를 덮지 않고, 사용자·세션 삭제 시 `ON DELETE SET NULL`이다. 공개 모티프의 소유권 필드는 아니다.
- `status`는 `pending | approved | rejected`이며 upsert 기본값은 `pending`, 신뢰된 seed는 `approved`를 명시한다. 검토 기능은 2026-10-19에 없앴고, `status`는 §8 registry fingerprint의 공개 풀(approved)만 정한다.

**정규화 파이프라인** `normalize_motif_svg`: sanitize 파싱·검증 → 프레임 검증 → 루트 presentation 래핑 → tight bbox 프레이밍 → paint 정규화 → `<g>` 래핑+content-hash id → (선택) render gate.

- **공용 intake 상한**: UTF-8 2MB, node 2,048, nesting depth 64, path 1,024, path command 50,000, geometry token 200,000. XML allowlist 검증 직후, geometry 계산과 render gate 전에 실패시킨다. implicit path 좌표 반복으로 command-letter 상한을 우회하지 못하도록 path 숫자와 polygon/polyline `points` 숫자를 하나의 token budget으로 센다. SVG 파일과 사진 vectorize 결과가 모두 이 경계를 공유한다. 방어적 `RecursionError`도 route에서 422로 변환한다.
- **루트 presentation 상속**: 루트 `<svg>`의 `fill`·`stroke`·`stroke-width`·`opacity`가 하나라도 있으면 자식 전체를 그 속성을 단 `<g>` 하나로 감싼 뒤 자식을 취한다. 루트를 그냥 버리면 `<svg fill="#c0445a">`의 도형이 검게, `<svg stroke="#000" fill="none">`의 선이 투명하게 바뀐다. 자식마다 복사하지 않고 감싸는 이유는 `opacity`가 그룹 단위 합성이기 때문이다. 루트 `color`는 아래 상속 규칙이 처리한다.
- **paint 정규화**: root/ancestor `color` 상속을 따라 `currentColor`·`inherit`를 실제 paint로 바꾸고(상속값 없으면 `#111111`), 모든 `fill`/`stroke`/`color`를 소문자 6/8자리 hex 또는 `none`으로 접는다. `rgb()`/`rgba()`는 hex로 변환(알파 버림), 3/4자리 hex는 확장, `transparent`는 `none`이다. **named color·Pantone spot·`url(#...)`은 거부** — hex를 확정할 수 없거나(전자) paint server라 모티프에 존재할 수 없다(후자, `<pattern>` 침투도 여기서 막힌다). 따라서 `red`/`rgb(255,0,0)`/`#F00`/`#FF0000`은 모두 같은 motif id다. 색 개수 양자화나 슬롯 토큰 치환은 하지 않는다.
- **render gate**(librsvg 있으면): 10mm/300dpi 고정 타일, margin 10%로 렌더 — 실패, 완전 투명(아무것도 안 그림), edge_seam > 2.0이면 거부. 모티프는 mutate하지 않음.

## 2. content-hash id

```
geometry = f'<g transform="translate({fmt(tx)} {fmt(ty)}) scale({fmt(scale)})">{inner}</g>'
motif_id = id_prefix + "-" + sha256(geometry.encode()).hexdigest()[:12]
```
- 해시 입력 = concrete paint를 포함한 geometry(심볼 래퍼 제외). 도형과 색이 모두 같을 때만 같은 id이며, 같은 도형이라도 색이 다르면 다른 id다. 카탈로그 seed는 `seed-`, private user import는 `upload-` prefix를 쓴다(과거 GPT Image 생성 행은 `gpt-image-`). 모든 ingress가 prefix를 명시하며 정규화 함수는 provider를 추정하지 않는다.

## 3~6. (삭제 — 2026-10-19 AI 디자인 제거)

## 7. 사용자 모티프 유입

사용자 SVG·사진 모티프는 명시적 preview→import 경로에서 exact private motif가 된다. 디자인에 들어가는 길은 로고 자리 교체(`/generate`의 `motif_slot`, worker-pipeline.md §5)뿐이다.

### 7.1 사진→SVG

`POST /motifs/photo-preview`는 store 색·로고 화면에서 완료한 private staged upload(`design_reference`)의 signed URL을 사용한다. JPEG/PNG/WebP 실제 MIME, 장당 10MB, 20M픽셀을 확인하고 최대 1024px로 축소한 뒤 CPU 처리를 thread pool에서 실행한다.

- **배경은 항상 지운다 — 옵션이 없다.** 배경이 남은 모티프는 넥타이 패턴이 될 수 없고, 사진 같은 입력은 배경을 살려도 벡터 예산을 넘겨 실패하므로 켜 둘 수 있는 경로가 아니었다. 별도 provider·대형 모델·GPU 없이 Pillow로 수행한다: 기존 alpha를 우선 사용하고, 아니면 테두리 median 색을 구한 뒤 유사색의 4-neighbor border-connected 영역만 제거한다. 균일한 테두리 confidence 0.55 미만, 빈 피사체, 프레임을 거의 채운 피사체는 명시 오류다. 복잡한 장면을 성공처럼 보이는 hidden fallback은 없다 — **되는 사진 조건은 store가 고르기 전에 안내한다.**
- 가까운 중간색만 채널 정밀도 양자화로 정리하고 VTracer `medium`으로 trace한 다음 근사색을 양자화 팔레트에 snap한다. 색상 수는 제한하지 않고 모티프에 따라 달라진다. 원본/중간 파일은 worker가 저장하지 않고 결과 SVG만 기존 private motif import 경계로 전달한다.
- 상한: vector SVG/processed PNG 각 2MB, node 2,048, path 1,024, path command 50,000. sanitizer/normalize도 저장 전에 다시 적용된다.
- 응답은 `{svg,processed_preview_base64,background_confidence,warnings}`. 동일 입력은 동일 SVG/PNG 바이트를 만든다. 요청은 `{image}`뿐이다 — 배경 유지·색상 수 옵션이 없고, 성공 경로의 `warnings`는 항상 빈 배열이다(영문 진단을 고객에게 노출하지 않는다).
- **사용자가 다른 사진으로 고칠 수 있는 거절은 코드를 싣는다** — `422 {detail:{code,message}}`, code는 `photo_background_unclear`(평면 배경 분리 불가: confidence 미달·빈 피사체·프레임 충전) 또는 `photo_too_detailed`(위 상한 초과). `message`는 영문 진단이라 고객에게 노출하지 않고, api가 코드로 한국어 문구를 고른다(`integrations/worker.py::_WORKER_REJECTIONS`, `/generate`와 같은 경로). 코드 없는 422(디코드 실패 등)는 일반 `worker_rejected`로 남는다. 코드를 싣지 않으면 "배경이 고르지 않다"와 실제 결함이 같은 문구로 뭉개져 사용자가 무엇을 바꿔야 할지 알 수 없다.

`POST /motifs/import`는 DB를 쓰지 않는 pure normalization 경계다. `{motif_id,symbol,bbox,anchor,preview_svg}`를 반환하고, API가 quota 확인과 함께 `Motif(source=user_upload)` 및 사용자 소유 링크를 하나의 transaction에 저장한다. 따라서 API transaction 실패가 ownerless private motif를 남기지 않는다. `preview_svg`는 저장 symbol과 같은 concrete paint의 standalone 문서이며 재-import해도 같은 content-hash identity와 geometry를 얻는다.

## 8. registry fingerprint

- `registry_version_for(store)`: 승인된 공개 풀 비면 `REGISTRY_VERSION("0.1.0")`, 아니면 `f"{REGISTRY_VERSION}+pool.{hex8}"`, hex8 = `format(stable_hash("\n".join(sorted(all_ids))), "064x")[:8]`. 시드 추가·삭제가 ID 집합을 바꿔 stamp도 함께 움직인다.
- 메모: (store identity, epoch) — epoch은 register/delete마다 +1. store 조회 실패 시 baseline 반환하되 **캐시하지 않음**.
- REGISTRY_VERSION 수동 bump는 스키마/포맷 변경 시에만 — 풀 추적은 fingerprint 몫.

## 9. 시드 카탈로그

`scripts/seed_head_catalog.py`: 모티프 5개(flower/whole ×3, leaf/whole ×2, 전부 style=flat, source="seed"). 멱등(content-hash id + ON CONFLICT DO NOTHING). 재구현 시 새 모노레포 시드로 이식.

재구현 확장(원본 외): `apps/worker/scripts/seed_motifs.py`가 인라인 시드(위 5개 + `circle` 원반, style=flat)에 더해 `motif_assets/*.svg`(Flaticon UIcons regular-rounded 웹폰트에서 추출한 글리프 91개 — 동물·마린·하늘·문장·과일·취미·식물, subject=파일명 첫 토큰, style=outline)를 concrete-color 기본 모티프로 `status=approved` 시드한다. 손으로 쓴 도형은 인라인에 둔다 — 에셋 라벨은 파일명 템플릿(`"{stem} outline icon"`)이라 글리프가 아닌 것에는 맞지 않는다. 파일명 stem/token은 tags에도 넣는다.

시드는 멱등이며 시드 행 subject를 의도값으로 재기록한다(id는 SVG로 정해지므로 개명만 따라간다). 현재 시드 집합에 없고 어디서도 참조하지 않는 옛 `seed` 행은 지운다(`prune_stale_seeds`).

## 10. 설정값

motif_max_aspect_ratio=20.0, motif_edge_seam_tol=2.0, motif_render_check=True. VTracer 단순화는 검증된 제품 고정값이다.

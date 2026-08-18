# worker 명세 1/3 — 결정론 SVG 엔진

**결정론 계약: (intent, seed, colorway, registry_version)이 같으면 SVG 바이트 동일.** 전 경로 순수 함수 — 전역 random·내장 hash() 사용 금지. 기준선은 `apps/worker/tests/golden/`의 커밋된 골든이다.

관련 문서: [worker-motifs.md](./worker-motifs.md), [worker-pipeline.md](./worker-pipeline.md)

## 1. Intent 스키마

모든 모델 `extra="forbid"`. 최상위 `Intent`:

| 필드 | 타입 | 기본 | 제약 |
|---|---|---|---|
| intent_version | int | 1 | |
| canvas | Canvas | 필수 | tile_mm(gt=0), dpi=300 |
| seed | int | 0 | RNG 소스 |
| production | Production | print | method ∈ {yarn_dyed, print}, max_colors=12(gt 0) |
| palette | PaletteSpec | 필수 | slots 1..64 (id, hex, spot?, name?) |
| colorways | list[ColorwaySpec] | 필수 | 1..32 (id, name?, mapping: slot→색) |
| layers | list[Layer] | 필수 | 1..64, discriminator=type |

레이어 공통: `id, type, params, z_order, opacity(0..1, 기본 1.0), clip?`. 종류:
- **background**: params.color(슬롯 id)
- **stripe**: params `{angle, period_mm(gt0), bands[1..256]}`, Band=`{offset_mm, width_mm(gt0), color}`
- **motif**: params `{motif_id, size_mm(gt0)}`. 색은 registry symbol의 concrete paint로 고정된다. + placement?

Placement: `type ∈ {lattice, point_set, path_following, scatter}` + type별 spec 정확히 하나(경합 spec 거부, path_following은 셋 다 없어야):
- LatticeSpec: cell_w_mm/cell_h_mm(gt0), drop_fraction?(0<x<1), drop_axis ∈ {row, column}(기본 column), offset_x_mm/offset_y_mm(기본 0 — 격자 전체의 위상 이동, 두 모티프 슬롯을 엇갈리게 놓는 축)
- ScatterSpec: mode ∈ {poisson, sateen}, min_dist_mm?(gt0), count?(1..10000), sateen_n?(2..1024), sateen_step?(1..1024)
- PointSetSpec: points 1..10000
- path_following: host_layer+lane 또는 standalone path(PathSpec: kind ∈ {straight, wave}, angle?, wavelength?(gt0), amplitude?(ge0)) + spacing_mm(gt0), phase_mm=0, rotation ∈ {follow_path, fixed}?
- 모든 placement의 `fixed_rotation_deg?`는 구성 patch가 사용하는 결정론적 각도다. 생략 시 기존과 동일하게 0°이며 canonical layout JSON에서도 빠져 기존 layout id·SVG 바이트를 보존한다. path-following에서 `rotation=follow_path`면 tangent가 우선한다.

`validate_intent`의 결정론적 repair(경고 발생): dpi→ALLOWED_DPI(150,300,600) 최근접, off-grid stripe period→`tile/(k·hypot(p,q))` 스냅(밴드 비례, round 6자리), 다중밴드 bare lane(start/center/end)→b0.*, ground-gap(coverage > 0.75) 축소·균등 배치. drop_fraction 허용값 `(0.5, 1/3, 0.25)`.

## 2. compose — SVG 합성

문서 토폴로지(단일 라인, XML 선언·개행 없음):
```
<svg xmlns="http://www.w3.org/2000/svg" width="{W}mm" height="{H}mm" viewBox="0 0 {W} {H}">
  <defs>{symbol_defs...}{pattern}</defs>
  <rect x="0" y="0" width="{W}" height="{H}" fill="url(#tile)"/>
</svg>
```
- W=H=tile_mm(fmt). pattern: `<pattern id="tile" patternUnits="userSpaceOnUse" width height>{content}</pattern>`. defs 비면 블록 생략.
- **요소 순서**: layers를 `(z_order, id)`로 정렬 → fragment 순서. opacity≠1.0이면 `<g opacity="{fmt}">` 래핑. symbol_defs는 dict 삽입순(정렬 layer 순회 중 최초 등장 시 setdefault 1회).
- **모티프 `<use>`**: symbol은 최초 등장 시 한 번만 등록하고 각 인스턴스는 `<use href="#motif-{id}" transform="{t}"/>` 하나로 렌더한다. `color` 속성을 주입하지 않는다.
- id: pattern `tile`, 모티프 심볼 `motif-{id}`.
- **인스턴스 transform**: `translate(x y) rotate(deg) scale(size_mm/extent)` (+ anchor≠(0,0)이면 `translate(-ax -ay)`), extent = max(bbox 폭, 높이).
- **수치 포매팅 `fmt(v)`** (byte-identical 핵심): `f"{float(v):.4f}"`(round-half-to-even) → rstrip("0").rstrip(".") → 빈/"-0"/"-"이면 "0".
- **2MB 캡**: sanitize 재파싱 **전에** `len(doc.encode("utf-8")) > max_svg_bytes(2_000_000)` → ValueError → `design_invalid` 422.
- **sanitize**(최종 게이트, byte-stable): defusedxml 파싱(DTD·외부엔티티 금지) + 태그/속성/href/color 화이트리스트 검증 후 **입력 문자열 그대로 반환**(재직렬화 금지). 허용 태그: svg,defs,symbol,pattern,g,rect,line,circle,ellipse,use,path,polygon,polyline (text 없음). color는 currentColor/none/transparent/inherit/#hex(3~8)/url(#내부)만.

## 3. placement 4종

디스패치 `place(layer, host, tile_mm, seed)`:

- **lattice** (RNG 없음): `nx=round(tile/cw), ny=round(tile/ch)`; `nx*ny > 50_000`이면 오류. drop_axis=column → b1=(cw, ch·drop), b2=(0, ch); row → b1=(cw, 0), b2=(cw·drop, ch). `x=i·b1x+j·b2x+offset_x, y=i·b1y+j·b2y+offset_y`, 좌표 `% tile`(offset은 위상만 옮기므로 seamless 불변식과 무관), 회전은 `fixed_rotation_deg` 또는 0°. (block=drop 없음, half_drop=column, brick=row)
- **scatter**: sateen(RNG 없음) — `cell=tile/n`, `Instance(i·cell, ((i·step)%n)·cell)`; poisson(유일한 RNG 소비처) — `rng=random.Random(seed)`, capacity=`max(1, int(tile²/(min_dist²·(√3/2))))`, target=count or capacity, 시도 상한 `target×30`, **x 먼저 y 나중** `rng.random()·tile`, 토러스 거리(`dx=min(|Δ|, tile-|Δ|)`) ≥ min_dist면 채택.
- **path_following**: centerline은 host stripe lane 또는 standalone path. 각도 스냅 `snap_angle`(기울기 `Fraction.limit_denominator(16)`), 길이 `L=tile·hypot(p,q)`, `n=max(1,round(L/spacing)), spacing_eff=L/n`, `s=phase%L + k·spacing_eff (s < L-1e-9)`. straight: `x=offset·nx+s·dx`; wave: 법선방향 `amp·sin(2πs/λ)` 추가, tangent는 도함수 반영. rotation=follow_path면 tangent, 아니면 0.
- **point_set**: `(x%tile, y%tile, fixed_rotation_deg 또는 0)`.

**seamless 경계 클론**: 렌더 AABB(scale→rotate→translate 순 계산)가 타일 경계를 넘으면 `(dx,dy) ∈ {-1,0,1}²\{(0,0)}` 고정 순서로 시프트 복제(교차하는 것만), 원본 뒤에 append. 전제 size_mm ≤ tile_mm.

**seamless 불변식**(assert): stripe commensurate(`round(tile/(period·hypot))≥1`, tol 1e-6), motif size ≤ tile, wave λ가 lane 길이를 나눔, lattice cell이 tile을 나눔, sateen `gcd(step,n)==1`.

## 4. compose_design — 디자인 1개 합성

원본의 후보 팬아웃(layout 변이 × colorway × seed로 최대 8개)은 **폐기됐다**. 후보 선택 UI가
없으므로 변주 축도 없다. 남은 계약은 `compose_design(intent, *, seed, colorway, motifs)
-> ComposedDesign` 하나다.

- **colorway 선택**: 요청이 지정하면 그것만. 미지정이면 원본 rank 1위와 같은 결과가 나오도록
  **distinct 해석색 수가 가장 적은 colorway, 동수면 id 순**을 고른다.
- **design_id** = `sha256(f"{layout_id}:{colorway_id}:{seed}")[:16]`.
- **layout_id** = `sha256(canonical_json(intent exclude {seed, colorways, palette}, exclude_none))[:12]`,
  canonical = `json.dumps(sort_keys=True, separators=(",",":"))`.
- 합성이 validate·불변식·2MB 캡을 통과하지 못하면 변이 drop이 아니라 그대로 실패한다
  (`design_invalid` 422). 대신 남길 것이 없으므로 "부분 성공" 경고 코드도 없다.
- 결정론 계약은 `golden/candidates.json`(원본 엔진의 rank 1위 후보)과 layout·colorway·seed·
  **SVG 바이트**까지 대조해 유지한다 — 파일명은 기준선의 출처를 가리키는 역사적 이름이다.

## 5. 결정론 장치

- RNG는 요청 seed로 만든 지역 `random.Random(seed)`뿐이다(`placement.py`의 scatter poisson에서 인라인 생성). 전역 RNG·시간·프로세스 hash 미사용.
- `stable_hash(text) = int(sha256(text).hexdigest(), 16)` (전체 digest). 내장 hash() 금지.
- PYTHONHASHSEED 독립: 모든 순회는 정렬 or 삽입순 dict. 대조 테스트가 hashseed 0/1/12345 서브프로세스 바이트 동일을 검증.
- effective seed: 요청 seed(override) 없으면 intent.seed. compose 전 경로가 같은 seed를 본다.

## 6. colorway

- Palette 검증: slot/colorway id 중복 금지, **`default` colorway 필수**, 각 colorway는 선언 슬롯 전부를 정확히 매핑(누락·미지 모두 에러).
- 슬롯 hex는 프리뷰용 비권위 — 출력색은 항상 colorway 매핑 해석(`resolve_color(slot, cw?)`, cw 없으면 default).
- colorway는 background와 stripe slot만 해석한다. 모티프의 concrete paint는 colorway와 독립적이다.
- `distinct_colors(cw)` = 해석색 집합(colorway 자동 선택 기준). 속성 삽입 시 html.escape.

## 7. repro 메타

frozen `ReproMeta{intent_version, seed, colorway_id, engine_version("0.1.0"), registry_version, layout_id}`. HTTP 응답에는 미포함 — 생성 로그(`seamless_generation_logs.design`)에만 `{id, layout_id, source_fidelity("vector"), colorway_id, seed, svg, png_object_key, intent}` 단일 객체로 저장한다.

## 7.1 생성 경계의 결정론 가드

`POST /generate`는 구조화된 사용자 제약을 더 이상 받지 않는다. 크기·밀도·배치·방향을 UI
노브로 받던 4축 설정과 색 지정(fixed palette)은 전 계층에서 폐기됐다 — 색을 포함한 그 축들은
입력창 문장 → 구성 patch(`worker-pipeline.md`)가 바꾼다. 모델은 unknown field를 거부하므로
옛 `palette` 필드를 보내면 422다.

경계에 남은 기계는 격자 겹침 클램프 하나뿐이다: 격자 배치 모티프의 `size_mm`이 셀의 1.15배를
넘으면 상한으로 줄이고 경고를 남긴다(저작 모델이 크기와 행·열을 서로 모르는 필드로 내보내므로).
허용치가 1.15배이므로 **격자에서는 15%까지의 겹침이 정상값이다** — "겹치지 않게"라는 요청은
격자 배치로 완전히 만족될 수 없고, 밀도를 낮추는 것이 유일한 응답이다.

줄어든 크기는 셀을 되돌려도 복구되지 않으므로(다음 patch가 `motif_size_mm`을 안 쓰면 영구),
**구성 patch는 크기 대신 밀도를 양보한다**: `placement`만 바꾸고 `motif_size_mm`을 건드리지
않은 patch는 현재 크기가 셀에 들어가는 최대 축 개수로 `count_per_axis`를 낮춘다(엇갈림은
짝수 축으로 올림되므로 상한도 짝수로 내린다). 두 축을 함께 바꾼 patch는 요청한 밀도를 그대로
받고 크기 클램프가 적용된다.

`seamless_generation_logs.intent`에는 `{design, resolved_plan}`(+구성 patch 런은 `patch`,
모티프 슬롯 교체 런은 `motif_slot`)이 기록된다 — 전부 단수 키다.

## 8. 엔진 설정·상수

Settings: max_placement_instances=50_000, max_svg_bytes=2_000_000, max_tile_mm=2000.0, max_dpi=600, stripe_max_band_coverage=0.75, preview_dpi=192, fabric_dpi=300, generate_cache_size=0(재구현에서 미승계 — stateless), motif_max_aspect_ratio=20.0, motif_edge_seam_tol=2.0, motif_render_check=True.

상수: ENGINE_VERSION="0.1.0", REGISTRY_VERSION="0.1.0", ALLOWED_DPI=(150,300,600), DEFAULT_DPI=300, MM_PER_INCH=25.4, MAX_LANE_PERIOD_TILES=16(각도 스냅 분모 캡), mm_to_px=`round(mm/25.4·dpi)`,
LATTICE_OVERLAP_ALLOWANCE=1.15(격자 셀 대비 모티프 크기 상한 = 허용 겹침 15%, §7.1),
patch 축 개수 범위 MIN_AXIS_COUNT=2 / MAX_AXIS_COUNT=10.

## 9. 재현 함정 (원본 코드가 명시한 것)

1. `fmt`의 정확한 순서(.4f → 후행 0/점 제거 → -0 정규화)를 지킬 것.
2. 모티프 symbol은 한 번만 등록하고 모든 인스턴스가 같은 concrete-color symbol을 참조한다.
3. sanitize는 검증만 하고 문자열을 재직렬화하지 않는다.
4. 결정론은 동일한 Pillow·렌더러·에셋 버전이 전제다. Pillow는 `uv.lock`으로 고정되지만 librsvg 시스템 패키지 버전 고정은 남아 있다(ARCHITECTURE §6·§8.2).

# worker 명세 1/3 — 결정론 SVG 엔진 (seamless-tile 추출)

원본: `../seamless-tile`의 `app/engine/`, `app/render/{svg,sanitize}.py`, `app/validate/intent.py`. **결정론 계약: (intent, seed, colorway, registry_version)이 같으면 SVG 바이트 동일.** 전 경로 순수 함수 — 전역 random·내장 hash() 사용 금지. 수식·상수는 원문 그대로, 어기면 byte-identical 대조 테스트가 깨진다.

관련 문서: [worker-motifs.md](./worker-motifs.md), [worker-pipeline.md](./worker-pipeline.md)

## 1. Intent 스키마

모든 모델 `extra="forbid"`. 최상위 `Intent`:

| 필드 | 타입 | 기본 | 제약 |
|---|---|---|---|
| intent_version | int | 1 | |
| canvas | Canvas | 필수 | tile_mm(gt=0), dpi=300 |
| seed | int | 0 | RNG 소스 |
| production | Production | print | method ∈ {yarn_dyed, print} (legacy digital/screen→print 매핑), max_colors=12(gt 0) |
| palette | PaletteSpec | 필수 | slots 1..64 (id, hex, spot?, name?) |
| colorways | list[ColorwaySpec] | 필수 | 1..32 (id, name?, mapping: slot→색) |
| layers | list[Layer] | 필수 | 1..64, discriminator=type |

레이어 공통: `id, type, params, z_order, opacity(0..1, 기본 1.0), clip?`. 종류:
- **background**: params.color(슬롯 id)
- **stripe**: params `{angle, period_mm(gt0), bands[1..256]}`, Band=`{offset_mm, width_mm(gt0), color}`
- **motif**: params `{motif_id, size_mm(gt0), color|colors}` — **color(단색 슬롯)와 colors(멀티슬롯 매핑) 중 정확히 하나**. + placement?

Placement: `type ∈ {lattice, point_set, path_following, scatter}` + type별 spec 정확히 하나(경합 spec 거부, path_following은 셋 다 없어야):
- LatticeSpec: cell_w_mm/cell_h_mm(gt0), drop_fraction?(0<x<1), drop_axis ∈ {row, column}(기본 column)
- ScatterSpec: mode ∈ {poisson, sateen}, min_dist_mm?(gt0), count?(1..10000), sateen_n?(2..1024), sateen_step?(1..1024)
- PointSetSpec: points 1..10000
- path_following: host_layer+lane 또는 standalone path(PathSpec: kind ∈ {straight, wave}, angle?, wavelength?(gt0), amplitude?(ge0)) + spacing_mm(gt0), phase_mm=0, rotation ∈ {follow_path, fixed}?
- 모든 placement의 `fixed_rotation_deg?`는 구조화된 방향 제약이 사용하는 결정론적 각도다. 생략 시 기존과 동일하게 0°이며 canonical layout JSON에서도 빠져 기존 layout id·SVG 바이트를 보존한다. path-following에서 `rotation=follow_path`면 tangent가 우선한다.

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
- **멀티컬러 `<use>`**: instance-major/slot-minor — 인스턴스마다 슬롯 심볼들을 color_slots 순으로. 단색은 `<use href="#motif-{id}" color="{c}" transform="{t}"/>`.
- id: pattern `tile`, 단색 심볼 `motif-{id}`, 슬롯 심볼 `motif-{id}-s{k}`.
- **인스턴스 transform**: `translate(x y) rotate(deg) scale(size_mm/extent)` (+ anchor≠(0,0)이면 `translate(-ax -ay)`), extent = max(bbox 폭, 높이).
- **수치 포매팅 `fmt(v)`** (byte-identical 핵심): `f"{float(v):.4f}"`(round-half-to-even) → rstrip("0").rstrip(".") → 빈/"-0"/"-"이면 "0".
- **2MB 캡**: sanitize 재파싱 **전에** `len(doc.encode("utf-8")) > max_svg_bytes(2_000_000)` → ValueError(후보 경로에선 해당 변이 drop+경고, 직접 경로 422).
- **sanitize**(최종 게이트, byte-stable): defusedxml 파싱(DTD·외부엔티티 금지) + 태그/속성/href/color 화이트리스트 검증 후 **입력 문자열 그대로 반환**(재직렬화 금지). 허용 태그: svg,defs,symbol,pattern,g,rect,line,circle,ellipse,use,path,polygon,polyline (text 없음). color는 currentColor/none/transparent/inherit/#hex(3~8)/url(#내부)만.

## 3. placement 4종

디스패치 `place(layer, host, tile_mm, seed)`:

- **lattice** (RNG 없음): `nx=round(tile/cw), ny=round(tile/ch)`; `nx*ny > 50_000`이면 오류. drop_axis=column → b1=(cw, ch·drop), b2=(0, ch); row → b1=(cw, 0), b2=(cw·drop, ch). `x=i·b1x+j·b2x, y=i·b1y+j·b2y`, 좌표 `% tile`, 회전은 `fixed_rotation_deg` 또는 0°. (block=drop 없음, half_drop=column, brick=row)
- **scatter**: sateen(RNG 없음) — `cell=tile/n`, `Instance(i·cell, ((i·step)%n)·cell)`; poisson(유일한 RNG 소비처) — `rng=random.Random(seed)`, capacity=`max(1, int(tile²/(min_dist²·(√3/2))))`, target=count or capacity, 시도 상한 `target×30`, **x 먼저 y 나중** `rng.random()·tile`, 토러스 거리(`dx=min(|Δ|, tile-|Δ|)`) ≥ min_dist면 채택.
- **path_following**: centerline은 host stripe lane 또는 standalone path. 각도 스냅 `snap_angle`(기울기 `Fraction.limit_denominator(16)`), 길이 `L=tile·hypot(p,q)`, `n=max(1,round(L/spacing)), spacing_eff=L/n`, `s=phase%L + k·spacing_eff (s < L-1e-9)`. straight: `x=offset·nx+s·dx`; wave: 법선방향 `amp·sin(2πs/λ)` 추가, tangent는 도함수 반영. rotation=follow_path면 tangent, 아니면 0.
- **point_set**: `(x%tile, y%tile, fixed_rotation_deg 또는 0)`.

**seamless 경계 클론**: 렌더 AABB(scale→rotate→translate 순 계산)가 타일 경계를 넘으면 `(dx,dy) ∈ {-1,0,1}²\{(0,0)}` 고정 순서로 시프트 복제(교차하는 것만), 원본 뒤에 append. 전제 size_mm ≤ tile_mm.

**seamless 불변식**(assert): stripe commensurate(`round(tile/(period·hypot))≥1`, tol 1e-6), motif size ≤ tile, wave λ가 lane 길이를 나눔, lattice cell이 tile을 나눔, sateen `gcd(step,n)==1`.

## 4. candidates 생성

- 기본 4개, 최대 8 (`count = max(1, min(count, 8))`). 라우트 기본 1.
- 다양성 축(고정 순서): ① layout 변이 ② colorway(지정 시 그것만, 아니면 intent 전부) ③ seed(기본 `[base_seed]`; **scatter 있고 변이×colorway < count일 때만** `base_seed+1..count` 추가).
- layout 변이(`_layout_variants`, identity 먼저): stripe — 단일밴드 ratio∈(0.35, 0.65) + 리듬 `((5,2,2),0.5),((3,2,1),0.6)` / 다중밴드 `((5,11),0.4),((6,1,3),0.4)` (리듬: `u=period/(Σw+gap·(n-1))`, 색은 기존 순환); lattice — drop ∈ (None, 0.5, 1/3, 0.25) 변이 + cell nx±1/ny±1 + motif size; path — spacing×0.75/×1.5 + motif size; motif size — factor ∈ (0.75, 1.35), `min(tile, size·factor)`. 수치는 `round(v, 6)` 양자화.
- 각 변이는 validate+불변식 통과해야 채택, `layout_id`로 de-dup. `available_strategies = len(variants)`.
- **rank_key** = `(color_count, clustering, layout_id, colorway_id, seed)` — color_count=colorway 해석색 수, clustering=Σ placement rank `{path_following:2, lattice:1, point_set:1, scatter:0}`(낮을수록 선호).
- SVG 문자열 de-dup(동일 SVG는 rank 최소 보존) → 선택: Pass1 distinct layout당 1개, Pass2 잔여 채움 → rank_key 정렬.
- 다양성 경고: count≥2에서 distinct layout < min(2, available) → "diversity shortfall", 선택수 < count → "partial".
- **candidate_id** = `sha256(f"{key}:{colorway_id}:{seed}")[:16]`, key = layout_id(design_index 0) 또는 `f"{i}:{layout_id}"`.
- **layout_id** = `sha256(canonical_json(intent exclude {seed, colorways, palette}, exclude_none))[:12]`, canonical = `json.dumps(sort_keys=True, separators=(",",":"))`.
- **멀티 디자인**(designs[]): design별 후보 생성 → 전역 SVG de-dup(동률은 낮은 design_index) → **round-robin** 선택 → rank 정렬. 일부 무효는 "design {i} dropped" 경고, 전부 무효만 raise.

## 5. 결정론 장치

- `seeded_rng(seed)=random.Random(seed)` — 소비처는 scatter poisson뿐.
- `stable_hash(text) = int(sha256(text).hexdigest(), 16)` (전체 digest). 내장 hash() 금지.
- `select_variant(pool_ids, variant_group, seed) = sorted(pool_ids)[stable_hash(f"{group}:{seed}") % len(pool)]`.
- PYTHONHASHSEED 독립: 모든 순회는 정렬 or 삽입순 dict. 대조 테스트가 hashseed 0/1/12345 서브프로세스 바이트 동일을 검증.
- effective seed: 요청 seed(override) 없으면 intent.seed — **모티프 변이 선택과 compose가 같은 seed를 봐야 함**.

## 6. colorway

- Palette 검증: slot/colorway id 중복 금지, **`default` colorway 필수**, 각 colorway는 선언 슬롯 전부를 정확히 매핑(누락·미지 모두 에러).
- 슬롯 hex는 프리뷰용 비권위 — 출력색은 항상 colorway 매핑 해석(`resolve_color(slot, cw?)`, cw 없으면 default).
- 멀티컬러: `colors`의 키 집합 == motif.color_slots(전 슬롯 정확히 1회). 슬롯 심볼은 활성 토큰→currentColor, 나머지→none — `fill="sK"`/`stroke="sK"` **정확일치 치환**(닫는 따옴표 포함 — s1/s10 충돌 방지).
- `distinct_colors(cw)` = 해석색 집합(rank의 color_count). 속성 삽입 시 html.escape.

## 7. repro 메타

frozen `ReproMeta{intent_version, seed, colorway_id, engine_version("0.1.0"), registry_version, layout_id}`. HTTP 응답에는 미포함 — 생성 로그(seamless_generation_logs)에만 후보별 `{id, design_index, layout_id, source_fidelity("vector"), colorway_id, seed, svg, png_url}` + intent(designs) 저장.

## 7.1 구조화된 생성 제약

`POST /generate`는 프롬프트와 별도로 다음 계약을 받는다. 두 모델 모두 unknown field를 거부한다.

```json
{
  "palette": {"mode": "fixed", "colors": ["#10243A", "#EFE6D4"]},
  "pattern_constraints": {
    "motif_scale": "small",
    "density": "dense",
    "arrangement": "staggered",
    "direction": "diagonal"
  }
}
```

- palette: `auto`는 colors가 없어야 한다. `fixed`는 중복 제거 후 2~5색이며 `#RGB`/`#RRGGBB`를 uppercase `#RRGGBB`로 정규화한다. 엔진이 사용 중인 palette slot을 요청 순서대로 결정적으로 치환하고 colorway를 `default` 하나로 고정한다. 요청색 전부가 실제 layer에서 사용될 slot 수가 없으면 422로 실패한다.
- motif_scale: small/medium/large를 tile 한 변의 10%/18%/28% `size_mm`로 변환한다.
- density: lattice 축당 4/6/8, path repeat 4/8/12, Poisson count 8/16/28로 변환한다.
- arrangement: lattice는 regular grid, staggered는 `drop_fraction=0.5, drop_axis=column`인 half-drop lattice, scatter는 Poisson이다. 프롬프트 문구만으로 흉내 내지 않는다.
- direction: horizontal/vertical/diagonal을 0°/90°/-45°로 변환해 stripe angle과 motif `fixed_rotation_deg`에 적용한다.
- Gemini는 같은 제약을 semantic DesignPlan 힌트로 받지만 권위 경계는 결정적 compiler와 엔진이다. compiler가 만든 intent에 제약을 적용한 뒤 검증하며, 각 후보도 다시 제약 충족을 검사한다. 고정된 scale/density/arrangement 축은 후보 다양화에서 잠근다. 표현 불가능하거나 후단에서 제약이 유실되면 임의 fallback 없이 단계별 422다.
- `seamless_generation_logs.intent`에는 `{designs, palette, pattern_constraints}`가 함께 기록된다. 모든 필드가 auto인 요청은 기존 렌더 경로와 byte-identical이다.

## 8. 엔진 설정·상수

Settings: max_placement_instances=50_000, max_svg_bytes=2_000_000, max_tile_mm=2000.0, max_dpi=1200, stripe_max_band_coverage=0.75, stripe_diagonal_repeats=2, preview_dpi=192, fabric_dpi=300, generate_cache_size=0(재구현에서 미승계 — stateless), motif_max_aspect_ratio=20.0, motif_edge_seam_tol=2.0, motif_render_check=True.

상수: ENGINE_VERSION="0.1.0", REGISTRY_VERSION="0.1.0", ALLOWED_DPI=(150,300,600), DEFAULT_DPI=300, MM_PER_INCH=25.4, MAX_LANE_PERIOD_TILES=16(각도 스냅 분모 캡), mm_to_px=`round(mm/25.4·dpi)`.

## 9. 재현 함정 (원본 코드가 명시한 것)

1. `fmt`의 정확한 순서(.4f → 후행 0/점 제거 → -0 정규화)를 지킬 것.
2. 멀티컬러 use 순서(instance-major/slot-minor)와 슬롯 토큰 정확일치 치환.
3. sanitize는 검증만 하고 문자열을 재직렬화하지 않는다.
4. 결정론은 동일한 Pillow·렌더러·에셋 버전이 전제다. Pillow는 `uv.lock`으로 고정되지만 librsvg 시스템 패키지 버전 고정은 남아 있다(ARCHITECTURE §7·§9.2).

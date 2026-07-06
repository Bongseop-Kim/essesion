"""테스트용 모티프 등록 + MVP intent — 원본 seamless-tile tests의 명세 재현.

circle/bee는 더 이상 내장 built-in이 아니므로(골든은 recraft-* id 사용) 엔진의
seamless/composition/determinism 기계를 고정 geometry로 검증하기 위해 TEST fixture로
동일 id·geometry를 등록한다. import 시점에 등록(결정론 subprocess 테스트가 pytest
없이 직접 import) — register_motif는 덮어쓰기라 재-import에 안전.
"""

from worker.motifs.registry import MotifDef, register_motif

_UNIT_BBOX = (-0.5, -0.5, 0.5, 0.5)
_ORIGIN = (0.0, 0.0)


def _symbol(motif_id: str, geometry: str) -> str:
    return f'<symbol id="motif-{motif_id}" overflow="visible">{geometry}</symbol>'


def register_test_motifs() -> None:
    """circle/bee를 고정 geometry로 등록 (멱등 — 덮어쓰기)."""
    register_motif(
        MotifDef(
            id="circle",
            symbol=_symbol("circle", '<circle cx="0" cy="0" r="0.5" fill="currentColor"/>'),
            bbox_mm=_UNIT_BBOX,
            anchor=_ORIGIN,
        )
    )
    register_motif(
        MotifDef(
            id="bee",
            symbol=_symbol(
                "bee",
                '<ellipse cx="0" cy="0" rx="0.22" ry="0.42" fill="currentColor"/>'
                '<ellipse cx="-0.3" cy="-0.1" rx="0.18" ry="0.28" fill="currentColor"/>'
                '<ellipse cx="0.3" cy="-0.1" rx="0.18" ry="0.28" fill="currentColor"/>',
            ),
            bbox_mm=_UNIT_BBOX,
            anchor=_ORIGIN,
        )
    )


def mvp_intent() -> dict:
    """session-4 MVP 시나리오: 배경 + 대각 stripe + 두 모티프 레인."""
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": 48, "dpi": 300},
        "seed": 184231,
        "production": {"method": "digital", "max_colors": 12},
        "palette": {
            "slots": [
                {"id": "ground", "hex": "#10243a", "spot": "19-4024 TCX", "name": "navy"},
                {"id": "accent", "hex": "#ef8a7a"},
                {"id": "gold", "hex": "#f5ca57"},
            ]
        },
        "colorways": [
            {
                "id": "default",
                "name": "default",
                "mapping": {"ground": "#10243a", "accent": "#ef8a7a", "gold": "#f5ca57"},
            }
        ],
        "layers": [
            {"id": "ground", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {
                "id": "stripe_base",
                "type": "stripe",
                "z_order": 1,
                "params": {
                    # -36.87deg는 3-4-5 기울기(p/q = -3/4)로 스냅; 대각 stripe는
                    # period_mm = tile_mm / (k*hypot(p, q)) = 48 / (k*5)에서만 tiling되므로
                    # period 9.6(k=1)이 seamless. width < period.
                    "angle": -36.87,
                    "period_mm": 9.6,
                    "bands": [{"offset_mm": 0, "width_mm": 4.8, "color": "accent"}],
                },
            },
            {
                "id": "circle_on_stripe",
                "type": "motif",
                "z_order": 2,
                "opacity": 1.0,
                "params": {"motif_id": "circle", "size_mm": 1.4, "color": "accent"},
                "placement": {
                    "type": "path_following",
                    "host_layer": "stripe_base",
                    "lane": "center",
                    "spacing_mm": 6,
                    "phase_mm": 0,
                },
            },
            {
                "id": "bee_on_stripe",
                "type": "motif",
                "z_order": 3,
                "params": {"motif_id": "bee", "size_mm": 5, "color": "gold"},
                "placement": {
                    "type": "path_following",
                    "host_layer": "stripe_base",
                    "lane": "end",
                    "spacing_mm": 24,
                    "phase_mm": 12,
                    "rotation": "follow_path",
                },
            },
        ],
    }

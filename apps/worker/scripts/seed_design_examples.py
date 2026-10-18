"""디자인 예시 갤러리 시드 — 스토어 첫 진입 큐레이션(design_examples).

예시는 run(seamless_generation_logs) 포인터만 들고 있으므로(db/models/design.py
DesignExample) 시드가 할 일은 "run 한 벌을 만들어 두는 것"이다. 아래 `CURATED`의 템플릿
플랜(DesignPlanV3)을 결정론 컴파일러·엔진에 통과시켜 run을 만든다 — 같은 플랜+모티프+seed면
언제나 같은 SVG라 외부 API도 과금도 없다.

모티프는 subject로 카탈로그에서 고른다(content-hash id는 에셋이 바뀌면 달라지므로
하드코딩하지 않는다). 먼저 `seed_motifs.py`를 돌려야 한다.

프리뷰 PNG는 만들지 않는다 — 갤러리는 run의 design.svg만 그리고(api
domains/design/examples.py `_preview_svg`), 래스터화는 librsvg에 의존해 시드 환경을
가린다. 스토리지 업로드가 없으므로 GCS 에뮬레이터도 필요 없다.

멱등 — run_id를 example_id에서 uuid5로 파생시켜 로그·예시를 upsert한다. 다시 돌리면
같은 행을 현재 엔진 결과로 덮어쓰고, CURATED에 없는 예시 행은 지운다(run 로그는 남긴다).

실행: docker compose up -d && uv run alembic -c db/alembic.ini upgrade head
      && uv run python apps/worker/scripts/seed_motifs.py
      && uv run python apps/worker/scripts/seed_design_examples.py
"""

import asyncio
import math
import uuid
from dataclasses import dataclass, field
from typing import Any

from db.models.design import DesignExample
from db.models.seamless import Motif, SeamlessGenerationLog
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from worker.config import get_settings
from worker.db import build_engine
from worker.design_plan.compiler import DEFAULT_TILE_MM, compile_design_plan_v3
from worker.design_plan.schema import DesignPlanV3, snapshot_resolved_plan
from worker.engine.compose import compose_design
from worker.engine.constraints import apply_generation_constraints
from worker.motifs.fingerprint import registry_version_for
from worker.motifs.registry import MotifDef
from worker.motifs.store import get_motifs

# run_id 파생 네임스페이스 — 예시 하나당 run 하나를 안정적으로 재지정한다.
RUN_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://essesion.local/design-examples")
# 골든 픽스처와 같은 앵커. 산포·경로 배치의 난수를 고정한다.
SEED = 20240


@dataclass(frozen=True, kw_only=True)
class CuratedExample:
    """템플릿 플랜 하나 + 카탈로그 모티프 선택 + 카드 문구."""

    example_id: str
    name: str
    caption: str
    # 플랜의 input motif 슬롯에 순서대로 꽂을 카탈로그 subject.
    motif_subjects: tuple[str, ...] = field(default=())
    # 템플릿 데이터 — 여기가 정본이고 design_examples 컬럼은 store 전달용(DB로 관리하지 않는다).
    category: str = "그림"  # 목록 필터 칩 라벨 그대로
    point: str = "none"  # 포인트 로고 자리: none(올패턴)|top(매듭)|bottom(끝)
    # 로고를 받을 자리 (슬롯, 업로드 칸 이름) — 순서대로 색·로고 화면의 업로드 칸이 된다. 슬롯 1|2는
    # 레이어 순서(플랜 input 순서 아님), "logo"는 panel 포인트 로고. 비우면 서버 규칙 한 자리.
    logo_slots: tuple[tuple[int | str, str], ...] = field(default=())
    # 사용자가 준비할 실사 사진 — store public/ 경로. None이면 결정론 샷을 그린다.
    photo_full_url: str | None = None
    photo_detail_url: str | None = None
    # 사용자가 고를 수 있는 부위 이름 — 플랜 `colors` 순서대로(인덱스가 같으면 같은 슬롯).
    # 이름이 붙은 슬롯만 색 고르기 화면에 나온다. 비우면 색을 바꿀 수 없는 템플릿.
    color_names: tuple[str, ...] = field(default=())
    plan: DesignPlanV3
    # 배치형(panel) 요소 — intent `panel` 형식(블레이드 프레임, worker-engine.md §2b). 색은 팔레트
    # 슬롯 id(`ground`·`color_<i>`), 모티프는 motif_id 대신 카탈로그 `subject`로 적는다.
    panel: tuple[dict[str, Any], ...] = field(default=())
    # 타일 배율 — 플랜 비율은 타일 기준이라 키우면 반복 주기가 길어져 타일당 자리가 늘어난다
    # (엇박 배치).
    tile_scale: float = 1.0


# 슬레이트 그레이 바탕의 가는 세 줄 사선(핀 스트라이프 트리오)과 줄 사이의 세 고리 — 타일 2배
# (96mm)에 사선 k=4. sateen 16·7은 x+y가 48의 배수라 고리가 틈 한 줄 걸러 우상향 띠로
# 늘어서고(띠 안 간격 17mm), 이웃 띠끼리 어긋나 세로·가로 일직선이 없다(엇박).
PIN_STRIPE_RINGS_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#2e3640", "#d9d4ca"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.1767767,
                "bands": [
                    {"offset_ratio": 0.4467, "width_ratio": 0.02, "color_index": 1},
                    {"offset_ratio": 0.49, "width_ratio": 0.02, "color_index": 1},
                    {"offset_ratio": 0.5333, "width_ratio": 0.02, "color_index": 1},
                ],
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.07,
                "placement": {"type": "scatter", "mode": "sateen", "order": 16, "step": 7},
            },
        ],
    }
)


# 네이비 바탕의 로고와 작은 점 — 타일 2배(96mm). 로고는 sateen 12·5라 가장 가까운 이웃이 결과 같은
# 45° 우상향 사슬(2,-2)/12로 서고(다음 이웃은 1.5배 멀어 사슬이 또렷하다) 세로·가로 일직선이 없다.
# 사슬은 x+y ≡ 0·½ 두 레인에 놓이므로 점은 레인마다 경로 하나(원점 + 바탕색 레인 밴드)로 로고
# 사이 한가운데에 둔다.
LOGO_DOTS_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#1b2547", "#d8c7a8"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.1,
                "placement": {"type": "scatter", "mode": "sateen", "order": 12, "step": 5},
            },
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.70710678,
                "bands": [
                    {"offset_ratio": 0.499, "width_ratio": 0.002, "color_index": 0},
                ],
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.0225,
                "placement": {
                    "type": "path",
                    "kind": "straight",
                    "direction": "diagonal_up",
                    "spacing_ratio": 0.16666667,
                    "phase_ratio": 0.08333333,
                    "rotation": "fixed",
                    "fixed_rotation_deg": 0.0,
                },
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.0225,
                "placement": {
                    "type": "path",
                    "kind": "straight",
                    "direction": "diagonal_up",
                    "spacing_ratio": 0.16666667,
                    "phase_ratio": 0.08333333,
                    "host_stripe_index": 0,
                    "host_band_index": 0,
                    "rotation": "fixed",
                    "fixed_rotation_deg": 0.0,
                },
            },
        ],
    }
)


# 01 — 클래식 렙 스트라이프: 네이비 바탕에 아이보리 줄이 양옆을 감싼 크림슨 띠를 우상향(/) 사선으로
# 촘촘히(k=3) 반복한다. 원색 흰·빨강은 카드에서 떨려 보여 한 톤 눌렀다. 로고는 panel 방패 하나.
ALTIS_STRIPE_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#1b2a52", "#e6dfcf", "#9e1b2a"],
        "ground_color_index": 0,
        "motifs": [],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.23570226,
                "bands": [
                    {"offset_ratio": 0.28, "width_ratio": 0.05, "color_index": 1},
                    {"offset_ratio": 0.42, "width_ratio": 0.16, "color_index": 2},
                    {"offset_ratio": 0.67, "width_ratio": 0.05, "color_index": 1},
                ],
            },
        ],
    }
)


# 02 — 차콜 바탕에 은색 두 줄·초록 한 줄 사선(k=2) 사이, 바탕색 레인(밴드 2) 위로 잎 가지를
# 1/5 간격으로 줄지어 흘린다 — 스트라이프와 모티프 행이 번갈아 나오는 구조.
SPRIG_STRIPE_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#2a2d32", "#c9ccd1", "#2fa877"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.35355339,
                "bands": [
                    {"offset_ratio": 0.12, "width_ratio": 0.025, "color_index": 1},
                    {"offset_ratio": 0.17, "width_ratio": 0.025, "color_index": 1},
                    {"offset_ratio": 0.5, "width_ratio": 0.004, "color_index": 0},
                    {"offset_ratio": 0.83, "width_ratio": 0.02, "color_index": 2},
                ],
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.12,
                "placement": {
                    "type": "path",
                    "kind": "straight",
                    "direction": "diagonal_up",
                    "spacing_ratio": 0.2,
                    "phase_ratio": 0.0,
                    "host_stripe_index": 0,
                    "host_band_index": 2,
                    "rotation": "fixed",
                    "fixed_rotation_deg": 0.0,
                },
            },
        ],
    }
)


# 03 — 버건디 바탕에 가는 잔 격자(사선 두 방향, 타일당 k=4)를 깔고, 격자 칸 한가운데에 흰 꽃문양을
# 2×2 격자로 놓는다. 띠를 주기 0.5에 맞춰서 꽃문양과 육각 엠블럼(diagonal_pair)이
# 항상 마름모 안에 놓인다.
EMBLEM_FLEUR_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#6b1424", "#5c1120"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.1767767,
                "bands": [{"offset_ratio": 0.48, "width_ratio": 0.04, "color_index": 1}],
            },
            {
                "type": "stripe",
                "direction": "diagonal_down",
                "period_ratio": 0.1767767,
                "bands": [{"offset_ratio": 0.48, "width_ratio": 0.04, "color_index": 1}],
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.12,
                "placement": {
                    "type": "lattice",
                    "columns": 2,
                    "rows": 2,
                    "drop": "none",
                    "fixed_rotation_deg": 0.0,
                },
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.12,
                "placement": {"type": "point_template", "template": "diagonal_pair"},
            },
        ],
    }
)


# 04 — 블록 스트라이프: 로열 블루와 네이비 굵은 띠가 반반 번갈아(k=1) 흐르고 경계에 흰 줄.
# diagonal_pair 두 점은 사선 위상 0.5(네이비 띠 한가운데)에 놓여 물결 엠블럼이 늘 짙은 띠 위에 온다.
WAVE_REGIMENTAL_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#2448a8", "#16224f", "#e9e6df"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.70710678,
                "bands": [
                    {"offset_ratio": 0.235, "width_ratio": 0.012, "color_index": 2},
                    {"offset_ratio": 0.275, "width_ratio": 0.45, "color_index": 1},
                    {"offset_ratio": 0.753, "width_ratio": 0.012, "color_index": 2},
                ],
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.13,
                "placement": {"type": "point_template", "template": "diagonal_pair"},
            },
        ],
    }
)


# 05 — 진녹색 바탕에 마름모 메달리온을 45° 엇갈림 격자로 깔고(2×4 하프로우: 가로 0.5, 세로 0.25),
# 대각선으로 이웃한 메달리온 사이 한가운데(grid4_inset 16점)에 아주 작은 나무 로고를 점처럼 박는다.
TREE_MEDALLION_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#123f2c", "#c9a961"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.2,
                "placement": {
                    "type": "lattice",
                    "columns": 2,
                    "rows": 4,
                    "drop": "half_row",
                    "fixed_rotation_deg": 0.0,
                },
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.04,
                "placement": {"type": "point_template", "template": "grid4_inset"},
            },
        ],
    }
)


# 06 — 네이비 바탕에 마름모 넷 묶음을 quincunx_inset으로 엇갈려 깔고, 타일 모서리(격자 1×1)에
# 큐브 로고 하나를 둔다 — 로고가 묶음 넷이 둘러싼 빈자리에 들어가 엇갈림 격자의 한 칸이 된다.
CUBE_DIAMOND_CLUSTER_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#16224a", "#3a68b8"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.19,
                "placement": {"type": "point_template", "template": "quincunx_inset"},
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.14,
                "placement": {
                    "type": "lattice",
                    "columns": 1,
                    "rows": 1,
                    "drop": "none",
                    "fixed_rotation_deg": 0.0,
                },
            },
        ],
    }
)


# 07 — 밝은 빨강 바탕에 양 사선 중간 빨강 밴드(주기의 반)를 엇갈려 3톤 다이아 체크를 만들고,
# 두 밴드가 겹치는 칸에는 진한 마름모를 얹는다. 격자 4×2 하프드롭이 교차점과 맞물리게
# 밴드를 반 칸 비켜 깔았다.
# 크림색 R은 그중 두 칸(0,0)·(½,½)에만 놓인다.
CHECK_R_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#c8202f", "#a11826"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.35355339,
                "bands": [
                    {"offset_ratio": 0.0, "width_ratio": 0.25, "color_index": 1},
                    {"offset_ratio": 0.75, "width_ratio": 0.25, "color_index": 1},
                ],
            },
            {
                "type": "stripe",
                "direction": "diagonal_down",
                "period_ratio": 0.35355339,
                "bands": [
                    {"offset_ratio": 0.0, "width_ratio": 0.25, "color_index": 1},
                    {"offset_ratio": 0.75, "width_ratio": 0.25, "color_index": 1},
                ],
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.255,
                "placement": {
                    "type": "lattice",
                    "columns": 4,
                    "rows": 2,
                    "drop": "half_column",
                    "fixed_rotation_deg": 0.0,
                },
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.1,
                "placement": {
                    "type": "lattice",
                    "columns": 2,
                    "rows": 1,
                    "drop": "half_column",
                    "fixed_rotation_deg": 0.0,
                },
            },
        ],
    }
)


# 08 — 가로 바 스트라이프: 블루 바탕에 은색 두 줄·금색 한 줄 바를 24mm마다 가로로 두고(타일
# 1.5배 72mm, 주기 1/3), 바 사이 칸 세 줄마다 바탕색 레인 위 가로 경로로 날개 엠블럼을 36mm 간격으로
# 놓는다. 행마다 12mm씩 왼쪽으로 밀어 날개가 우상향 사슬로 서고(엇박, 같은 열은 3행 뒤), 카드 끝
# 로고 행의 날개는 로고 양옆에 같은 간격으로 비켜 잡았다. horizontal offset은 위에서 잰다.
SKYLINE_WINGS_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#2a4f9e", "#c9ccd2", "#d9a441"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "stripe",
                "direction": "horizontal",
                "period_ratio": 0.33333333,
                "bands": [
                    {"offset_ratio": 0.17, "width_ratio": 0.03, "color_index": 1},
                    {"offset_ratio": 0.23, "width_ratio": 0.03, "color_index": 1},
                    {"offset_ratio": 0.31, "width_ratio": 0.02, "color_index": 2},
                ],
            },
            {
                "type": "stripe",
                "direction": "horizontal",
                "period_ratio": 1.0,
                "bands": [
                    {"offset_ratio": 0.24, "width_ratio": 0.002, "color_index": 0},
                    {"offset_ratio": 0.57333333, "width_ratio": 0.002, "color_index": 0},
                    {"offset_ratio": 0.90666667, "width_ratio": 0.002, "color_index": 0},
                ],
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.1133,
                "placement": {
                    "type": "path",
                    "kind": "straight",
                    "direction": "horizontal",
                    "spacing_ratio": 0.5,
                    "phase_ratio": 0.388889,
                    "host_stripe_index": 1,
                    "host_band_index": 0,
                    "rotation": "fixed",
                    "fixed_rotation_deg": 0.0,
                },
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.1133,
                "placement": {
                    "type": "path",
                    "kind": "straight",
                    "direction": "horizontal",
                    "spacing_ratio": 0.5,
                    "phase_ratio": 0.222222,
                    "host_stripe_index": 1,
                    "host_band_index": 1,
                    "rotation": "fixed",
                    "fixed_rotation_deg": 0.0,
                },
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.1133,
                "placement": {
                    "type": "path",
                    "kind": "straight",
                    "direction": "horizontal",
                    "spacing_ratio": 0.5,
                    "phase_ratio": 0.055556,
                    "host_stripe_index": 1,
                    "host_band_index": 2,
                    "rotation": "fixed",
                    "fixed_rotation_deg": 0.0,
                },
            },
        ],
    }
)


# 09 — 번트 오렌지 바탕에 크림색 가는 사선 두 갈래를 엇갈려 마름모 격자를 만들고(k=2), 로고(네 잎)를
# 4×4 격자에 작게 깔아 교차점·칸 중앙을 채운 뒤 2×2 네이비 꽃이 교차점의 절반을 덮는다.
MONETA_GRID_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#c8611f", "#ecd9b4"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.35355339,
                "bands": [{"offset_ratio": 0.0, "width_ratio": 0.02, "color_index": 1}],
            },
            {
                "type": "stripe",
                "direction": "diagonal_down",
                "period_ratio": 0.35355339,
                "bands": [{"offset_ratio": 0.0, "width_ratio": 0.02, "color_index": 1}],
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.05,
                "placement": {
                    "type": "lattice",
                    "columns": 4,
                    "rows": 4,
                    "drop": "none",
                    "fixed_rotation_deg": 0.0,
                },
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.13,
                "placement": {
                    "type": "lattice",
                    "columns": 2,
                    "rows": 2,
                    "drop": "none",
                    "fixed_rotation_deg": 0.0,
                },
            },
        ],
    }
)


def _monogram_dash_layer(motif: int, band: int, phase: float, size: float) -> dict[str, Any]:
    return {
        "type": "motif",
        "motif_index": motif,
        "size_ratio": size,
        "placement": {
            "type": "path",
            "kind": "straight",
            "direction": "diagonal_up",
            "spacing_ratio": 1 / 3,
            "phase_ratio": phase,
            "host_stripe_index": 0,
            "host_band_index": band,
            "rotation": "follow_path",
        },
    }


# 10 — 네이비 바탕에 사선 점선 두 줄과 줄 위의 M 모노그램. 바탕색 스트라이프(눈에 안 보임)는
# lane만 내주고, 두 밴드(0·0.5)에 "세 토막 점선"과 M을 1/3 간격으로 엇갈려 얹는다 —
# 줄마다 M 사이에 점선 세 토막.
MONOGRAM_DASH_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#1a2236", "#8f98ac"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.70710678,
                "bands": [
                    {"offset_ratio": 0.0, "width_ratio": 0.005, "color_index": 0},
                    {"offset_ratio": 0.5, "width_ratio": 0.005, "color_index": 0},
                ],
            },
            _monogram_dash_layer(1, 0, 0.0, 0.32),
            _monogram_dash_layer(0, 0, 1 / 6, 0.09),
            _monogram_dash_layer(1, 1, 1 / 6, 0.32),
            _monogram_dash_layer(0, 1, 0.0, 0.09),
        ],
    }
)


# 04 — 네이비 바탕에 아이보리 마름모 점(가운데 진한 빨강)을 하프로우(96mm 타일에서 24mm 간격)로
# 깔고, 세리프 R은 점 자리를 차지하되 sateen 8·3으로 흩어 세로·가로 일직선이 없다. R 여덟 자리는
# 모두 점 자리 위에 떨어지고, 두 점 레이어(4×4 격자 + grid4_inset — 합치면 하프로우 전체)가
# avoid_motif_layer로 R과 겹치는 점만 비운다.
INITIAL_R_DOTS_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#141d3c", "#efe6d2"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.06,
                "placement": {"type": "scatter", "mode": "sateen", "order": 8, "step": 3},
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.05,
                "placement": {"type": "lattice", "columns": 4, "rows": 4, "drop": "none"},
                "avoid_motif_layer": 0,
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.05,
                "placement": {"type": "point_template", "template": "grid4_inset"},
                "avoid_motif_layer": 0,
            },
        ],
    }
)


# 06 — 버건디 바탕에 타일마다 세로 스트라이프 묶음 하나(왼쪽부터 굵은 회색·아이보리·검정·회색·
# 가는 아이보리). vertical 밴드의 offset은 오른쪽에서 잰다 — 화면 순서와 반대로 적는다. 묶음은
# 카드의 포인트 로고 자리(panel)를 비우도록 민 위상이고, 무늬 속 작은 로고는 두지 않는다.
VALMONT_VERTICAL_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#5e1620", "#8e8a88", "#e6dccb", "#1c1416"],
        "ground_color_index": 0,
        "motifs": [],
        "layers": [
            {
                "type": "stripe",
                "direction": "vertical",
                "period_ratio": 1.0,
                "bands": [
                    {"offset_ratio": 0.33, "width_ratio": 0.08, "color_index": 1},
                    {"offset_ratio": 0.25, "width_ratio": 0.045, "color_index": 2},
                    {"offset_ratio": 0.175, "width_ratio": 0.04, "color_index": 3},
                    {"offset_ratio": 0.105, "width_ratio": 0.035, "color_index": 1},
                ],
            },
            {
                "type": "stripe",
                "direction": "vertical",
                "period_ratio": 1.0,
                "bands": [{"offset_ratio": 0.054, "width_ratio": 0.016, "color_index": 2}],
            },
        ],
    }
)


# 07 — 네이비 바탕에 아이보리 가는 줄을 양 사선(k=2)으로 겹친 큰 윈도페인 체크. 줄을 반 주기
# 밀어 칸 중앙이 0.25 격자에 오게 하고, 십자 로고를 diagonal_pair로 엇갈려 칸 속에 둔다 —
# 1×1은 십자가 세로 두 줄로만 박혀 단조로웠다.
_WINDOWPANE_LINE = [{"offset_ratio": 0.5, "width_ratio": 0.035, "color_index": 1}]
WINDOWPANE_CROSSLET_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#1b2a4e", "#e6d3a3"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.35355339,
                "bands": _WINDOWPANE_LINE,
            },
            {
                "type": "stripe",
                "direction": "diagonal_down",
                "period_ratio": 0.35355339,
                "bands": _WINDOWPANE_LINE,
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.12,
                "placement": {"type": "point_template", "template": "diagonal_pair"},
            },
        ],
    }
)


# 10 — 검정 바탕에 한 톤 밝은 차콜 물결선 — 한 파장짜리 두 줄 물결을 3열 2행으로 이어 붙여
# 0.25 타일 간격의 연속 가로 물결을 만들고, 작은 물결 원 로고는 줄 사이 틈에 diagonal_pair로
# 엇갈려 둔다(1×1은 행·열이 다 맞는 정배치라 기둥처럼 섰다).
MAREN_WAVE_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#121214", "#34373c"],
        "ground_color_index": 0,
        "motifs": [
            {"source": "input", "input_index": 1},
            {"source": "input", "input_index": 2},
        ],
        "layers": [
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.3345,  # 셀(1/3)보다 살짝 커서 이음매가 겹친다
                "placement": {
                    "type": "lattice",
                    "columns": 3,
                    "rows": 2,
                    "drop": "none",
                    "fixed_rotation_deg": 0.0,
                },
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.1,
                "placement": {"type": "point_template", "template": "diagonal_pair"},
            },
        ],
    }
)


# 배치형(panel) 템플릿 공통 — 바탕 위 한 톤 밝은 가는 사선(k=4)으로 원단 결만 깔고, 무늬는
# 블레이드에 한 번만 놓는 panel 요소가 맡는다(worker-engine.md §2b). 색 순서: 바탕, 결, 그 밖.
def _textured_plan(ground: str, grain: str, *others: str) -> DesignPlanV3:
    return DesignPlanV3.model_validate(
        {
            "colors": [ground, grain, *others],
            "ground_color_index": 0,
            "motifs": [],
            "layers": [
                {
                    "type": "stripe",
                    "direction": "diagonal_up",
                    "period_ratio": 0.1767767,
                    "bands": [{"offset_ratio": 0.0, "width_ratio": 0.18, "color_index": 1}],
                }
            ],
        }
    )


# 포인트 로고 자리(블레이드 프레임) — 어깨선 바로 위 오른쪽, 오른쪽 아래 모서리 고정. 카드의 끝
# 엠블럼(TieCanvas `SILHOUETTES.flat.emblem.tip`)과 같은 자리·면적이다.
PANEL_LOGO: dict[str, Any] = {
    "type": "motif",
    "at": [890, 975],
    "size": 140,
    "anchor": "bottom_right",
    "role": "logo",
}


def _disc(logo: dict[str, Any], *, radius: float, color: str, dy: float = 0.0) -> dict[str, Any]:
    """포인트 로고(bottom_right 앵커) 중심(+dy)의 원 근사 region — panel엔 원 요소가 없다."""
    (right, bottom), half = logo["at"], logo["size"] / 2
    cx, cy = right - half, bottom - half + dy
    return {
        "type": "region",
        "points": [
            [
                round(cx + radius * math.cos(2 * math.pi * i / 48), 2),
                round(cy + radius * math.sin(2 * math.pi * i / 48), 2),
            ]
            for i in range(48)
        ],
        "color": color,
    }


# 05 — 차콜 바탕의 잔 다이아 결(양 사선 가는 줄) 위에 V자 분할: 왼쪽 아래 면은 밝은 회색,
# 왼팔을 따라 와인 띠, 오른팔은 은색 선이 오른쪽 위 모서리로 올라간다.
TRENZ_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#3a3b3f", "#434449", "#6c6d72", "#6e1f2b", "#c9c9c9"],
        "ground_color_index": 0,
        "motifs": [],
        "layers": [
            {
                "type": "stripe",
                "direction": direction,
                "period_ratio": 0.1767767,
                "bands": [{"offset_ratio": 0.0, "width_ratio": 0.12, "color_index": 1}],
            }
            for direction in ("diagonal_up", "diagonal_down")
        ],
    }
)
_TRENZ_V = [500, 1030]


# 03 곡선 띠의 중심선 — 블레이드 위에서 곧게 내려오다 왼쪽으로 크게 휘어 눕고(첫 굽이), 어깨
# 근처에서 다시 아래로 꺾여(둘째 굽이) 어깨 왼쪽으로 빠지는 S자. 조각 이음점마다 앞뒤 제어점이
# 한 직선 위라 꺾임이 없다.
_BELLEN_DROP = ((790.0, -4600.0), (790.0, 0.0))
_BELLEN_BENDS = (
    ((790.0, 0.0), (790.0, 480.0), (640.0, 700.0), (400.0, 830.0)),
    ((400.0, 830.0), (200.0, 938.0), (-10.0, 1040.0), (-130.0, 1240.0)),
)


def _bezier(seg: tuple[tuple[float, float], ...], t: float) -> tuple[float, float, float, float]:
    """3차 베지어의 점과 단위 접선."""
    (x0, y0), (x1, y1), (x2, y2), (x3, y3) = seg
    u = 1 - t
    x = u**3 * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t**3 * x3
    y = u**3 * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t**3 * y3
    dx = 3 * (u * u * (x1 - x0) + 2 * u * t * (x2 - x1) + t * t * (x3 - x2))
    dy = 3 * (u * u * (y1 - y0) + 2 * u * t * (y2 - y1) + t * t * (y3 - y2))
    n = math.hypot(dx, dy)
    return x, y, dx / n, dy / n


def _bellen_band(offset: float, steps: int = 10) -> list[list[float]]:
    """곡선 띠를 중심선의 오른쪽 법선으로 offset만큼 민 평행선 — x로만 밀면 누운 구간에서 띠가
    가늘어진다. 휘는 조각마다 steps개 Hermite 조각(접선 = 중심선 접선)으로 다시 이어 매끄럽다."""
    (top_x, top_y), (_, join_y) = _BELLEN_DROP
    x = top_x + offset
    points = [[x, top_y], [x, top_y / 3], [x, top_y / 6], [x, join_y]]  # 곧은 조각
    for seg in _BELLEN_BENDS:
        samples = []
        for i in range(steps + 1):
            px, py, tx, ty = _bezier(seg, i / steps)
            samples.append((px + ty * offset, py - tx * offset, tx, ty))
        for (ax, ay, atx, aty), (bx, by, btx, bty) in zip(samples, samples[1:], strict=False):
            h = math.hypot(bx - ax, by - ay) / 3
            points += [[ax + atx * h, ay + aty * h], [bx - btx * h, by - bty * h], [bx, by]]
    return [[round(px, 1), round(py, 1)] for px, py in points]


# 02 세로 금선 — (x, 끝 y): 블레이드 위에서 내려와 서로 다른 높이에서 점으로 끝난다.
_MONDRE_LINES = ((70, 620), (180, 1060), (260, 760), (340, 1180), (410, 900), (480, 1300))


# 스토어 템플릿 목록 — 여기 없는 예시 행은 시드가 지운다(템플릿은 이 표가 정본).
CURATED: tuple[CuratedExample, ...] = (
    CuratedExample(
        example_id="template_stripe_pin_trio_rings",
        name="핀 스트라이프와 세 고리",
        caption="가는 세 줄 사선 사이에 놓인 작은 고리 엠블럼",
        motif_subjects=("ringtrio",),
        category="스트라이프",
        logo_slots=((1, "로고"),),
        color_names=("바탕", "가는 세 줄"),
        plan=PIN_STRIPE_RINGS_PLAN,
        tile_scale=2.0,
    ),
    CuratedExample(
        example_id="template_logo_halfdrop_dots",
        name="로고 하프드롭과 점",
        caption="네이비 바탕에 엇갈려 놓인 로고와 그 사이의 작은 점",
        motif_subjects=("monogram", "diamond"),
        category="로고",
        logo_slots=(
            (1, "로고"),
            (2, "작은 무늬"),
        ),
        color_names=("바탕",),
        plan=LOGO_DOTS_PLAN,
        tile_scale=2.0,
    ),
    CuratedExample(
        example_id="template_stripe_pair_apex",
        name="흰 줄과 빨간 줄 렙 스트라이프",
        caption="네이비 바탕에 아이보리 줄이 감싼 크림슨 띠가 촘촘히 반복되는 사선과 방패 문장",
        category="스트라이프",
        point="bottom",
        logo_slots=(("logo", "포인트 로고"),),
        color_names=("바탕", "흰 줄", "빨간 줄"),
        plan=ALTIS_STRIPE_PLAN,
        panel=({**PANEL_LOGO, "subject": "crest"},),
    ),
    CuratedExample(
        example_id="template_stripe_sprig",
        name="잎 가지가 흐르는 사선",
        caption="차콜 바탕의 은색 두 줄과 초록 줄 사이로 작은 잎 가지가 줄지어 흐르는 무늬",
        motif_subjects=("sprig",),
        category="스트라이프",
        point="bottom",
        logo_slots=((1, "로고"),),
        color_names=("바탕", "은색 두 줄", "초록 줄"),
        plan=SPRIG_STRIPE_PLAN,
    ),
    CuratedExample(
        example_id="template_emblem_fleur_diamond",
        name="육각 엠블럼과 꽃문양",
        caption="잔 마름모 격자의 버건디 바탕에 흰 꽃문양과 육각 엠블럼이 엇갈려 놓인 무늬",
        motif_subjects=("hexagon", "fleur"),
        category="패턴",
        point="bottom",
        logo_slots=(
            (2, "로고"),
            (1, "작은 무늬"),
        ),  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
        color_names=("바탕", "잔 격자"),
        plan=EMBLEM_FLEUR_PLAN,
    ),
    CuratedExample(
        example_id="template_regimental_wave_emblem",
        name="블록 스트라이프와 물결 엠블럼",
        caption="로열 블루와 네이비 굵은 띠가 번갈아 흐르고 짙은 띠 위에 물결 엠블럼",
        motif_subjects=("wave",),
        category="스트라이프",
        point="bottom",
        logo_slots=((1, "로고"),),
        color_names=("바탕", "굵은 띠", "가는 줄"),
        plan=WAVE_REGIMENTAL_PLAN,
    ),
    CuratedExample(
        example_id="template_tree_medallion",
        name="나무 엠블럼과 메달리온",
        caption="진녹색 바탕에 엇갈려 놓인 금빛 마름모 메달리온과 그 사이의 작은 나무",
        motif_subjects=("tree", "medallion"),
        category="패턴",
        point="bottom",
        logo_slots=(
            (2, "로고"),
            (1, "작은 무늬"),
        ),  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
        color_names=("바탕",),
        plan=TREE_MEDALLION_PLAN,
    ),
    CuratedExample(
        example_id="template_cube_diamond_cluster",
        name="큐브 엠블럼과 마름모 묶음",
        caption="네이비 바탕에 엇갈려 반복되는 푸른 마름모 네 개 묶음과 육각 큐브 엠블럼",
        motif_subjects=("cube", "cluster"),
        category="패턴",
        point="bottom",
        logo_slots=(
            (2, "로고"),
            (1, "작은 무늬"),
        ),  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
        color_names=("바탕",),
        plan=CUBE_DIAMOND_CLUSTER_PLAN,
    ),
    CuratedExample(
        example_id="template_check_serif_r",
        name="다이아 체크와 세리프 이니셜",
        caption="붉은 사선 체크 위 진한 칸마다 드문드문 놓인 크림색 세리프 이니셜",
        motif_subjects=("serif", "harlequin"),
        category="체크",
        point="bottom",
        logo_slots=(
            (2, "로고"),
            (1, "작은 무늬"),
        ),  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
        color_names=("바탕", "체크 줄"),
        plan=CHECK_R_PLAN,
    ),
    CuratedExample(
        example_id="template_stripe_skyline_wings",
        name="가로 바와 날개 엠블럼",
        caption="블루 바탕에 은색 두 줄과 금색 줄의 가로 바, 그 사이에 엇갈린 날개 엠블럼",
        motif_subjects=("wings",),
        category="스트라이프",
        point="bottom",
        logo_slots=((1, "로고"),),
        color_names=("바탕", "은색 두 줄", "금색 줄"),
        plan=SKYLINE_WINGS_PLAN,
        tile_scale=1.5,
    ),
    CuratedExample(
        example_id="template_quatrefoil_lattice_blossom",
        name="마름모 격자와 네이비 꽃",
        caption="오렌지 바탕의 가는 마름모 격자 위에 네이비 꽃과 작은 네 잎 로고",
        motif_subjects=("quatrefoil", "blossom"),
        category="패턴",
        point="bottom",
        logo_slots=(
            (1, "로고"),
            (2, "작은 무늬"),
        ),
        color_names=("바탕", "격자선"),
        plan=MONETA_GRID_PLAN,
    ),
    CuratedExample(
        example_id="template_monogram_dash_diagonal",
        name="모노그램 사선 점선",
        caption="짙은 네이비 바탕에 사선 점선을 따라 이어지는 은빛 M 모노그램",
        motif_subjects=("emblem", "dash"),
        category="모노그램",
        point="bottom",
        logo_slots=(
            (2, "로고"),
            (1, "작은 무늬"),
        ),  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
        color_names=("바탕",),
        plan=MONOGRAM_DASH_PLAN,
    ),
    CuratedExample(
        example_id="template_dot_initial_r",
        name="세리프 R과 마름모 도트",
        caption=(
            "네이비 바탕에 빨간 심을 품은 아이보리 마름모 점이 엇갈려 놓이고"
            " 점 자리 곳곳에 R 이니셜이 흩어져"
        ),
        motif_subjects=("initialr", "rhombdot"),
        category="도트",
        point="bottom",
        logo_slots=(
            (1, "로고"),
            (2, "작은 무늬"),
        ),
        color_names=("바탕",),
        plan=INITIAL_R_DOTS_PLAN,
        tile_scale=2.0,
        # 끝 엠블럼(큰 R) 뒤 바탕색 받침 — 흩어진 작은 R·점이 로고 밑에 비치지 않게. 색은 "ground"
        # 슬롯이라 바탕색을 바꾸면 같이 바뀐다. 로고는 panel이 아니라 엠블럼(logo_slots)이라 사용자
        # 로고는 여전히 무늬 속 R 자리에도 들어간다.
        panel=(_disc(PANEL_LOGO, radius=85, dy=10, color="ground"),),
    ),
    CuratedExample(
        example_id="template_initialv_vertical_stripe",
        name="세로 스트라이프와 세리프 V",
        caption="버건디 바탕에 회색·아이보리·검정 세로 줄 묶음과 아이보리 세리프 V 이니셜",
        category="스트라이프",
        point="bottom",
        logo_slots=(("logo", "포인트 로고"),),
        color_names=("바탕", "회색 줄", "아이보리 줄", "검정 줄"),
        plan=VALMONT_VERTICAL_PLAN,
        panel=({**PANEL_LOGO, "subject": "initialv"},),
    ),
    CuratedExample(
        example_id="template_windowpane_crosslet",
        name="윈도페인 체크와 십자 문장",
        caption="네이비 바탕에 아이보리 가는 줄이 사선으로 엇갈린 큰 체크와 칸 속 십자 문장",
        motif_subjects=("crosslet",),
        category="체크",
        point="bottom",
        logo_slots=((1, "로고"),),
        color_names=("바탕", "체크 줄"),
        plan=WINDOWPANE_CROSSLET_PLAN,
    ),
    CuratedExample(
        example_id="template_wave_line_emblem",
        name="물결선과 물결 원 엠블럼",
        caption="검정 바탕에 은은한 차콜 물결선이 가로로 흐르고 아이보리 물결 원 로고",
        motif_subjects=("undulation", "wave"),
        category="패턴",
        point="bottom",
        logo_slots=(
            (2, "로고"),
            (1, "작은 무늬"),
        ),  # 물결선 레이어가 먼저 그려져 로고는 레이어 순서상 두 번째
        color_names=("바탕",),
        plan=MAREN_WAVE_PLAN,
    ),
    CuratedExample(
        example_id="template_placement_diagonal",
        name="사선 분할과 세리프 A",
        caption="네이비 바탕을 아이보리 사선 한 줄이 가르고 아래 면은 한 톤 밝게",
        category="포인트",
        point="bottom",
        logo_slots=(("logo", "포인트 로고"),),
        color_names=("바탕", "결", "아래 면", "사선"),
        plan=_textured_plan("#1b2a52", "#223463", "#2a3f74", "#e6dcc3"),
        panel=(
            {
                "type": "region",
                "points": [[-50, 1155], [1050, 55], [1050, 1600], [-50, 1600]],
                "color": "color_2",
            },
            # 결(diagonal_up 45°)과 평행하게 — 기울기 1
            {"type": "line", "points": [[-50, 1155], [1050, 55]], "width": 14, "color": "color_3"},
            {**PANEL_LOGO, "subject": "apex"},
        ),
    ),
    CuratedExample(
        example_id="template_placement_gold_lines",
        name="세로 금선과 막대 로고",
        caption="짙은 초록 바탕 왼쪽에 길이가 다른 금선이 내려와 점으로 끝난다",
        category="포인트",
        point="bottom",
        logo_slots=(("logo", "포인트 로고"),),
        color_names=("바탕", "결", "금선"),
        plan=_textured_plan("#1d3a2c", "#21412f", "#c9a96a"),
        panel=(
            *(
                {
                    "type": "line",
                    "points": [[x, -4600], [x, end]],
                    "width": 6,
                    "color": "color_2",
                    "end_dot": 22,
                }
                for x, end in _MONDRE_LINES
            ),
            {**PANEL_LOGO, "subject": "bars"},
        ),
    ),
    CuratedExample(
        example_id="template_placement_curve_band",
        name="곡선 띠와 네잎 로고",
        caption="와인 바탕에 아이보리·검정 겹띠가 S자로 흘러 어깨 왼쪽으로 빠진다",
        category="포인트",
        point="bottom",
        logo_slots=(("logo", "포인트 로고"),),
        color_names=("바탕", "결", "띠", "띠 안쪽"),
        plan=_textured_plan("#6b1a26", "#731e2b", "#ece3cf", "#1e1a1c"),
        panel=(
            {"type": "curve_band", "points": _bellen_band(0), "width": 70, "color": "color_2"},
            {"type": "curve_band", "points": _bellen_band(60), "width": 50, "color": "color_3"},
            {"type": "curve_band", "points": _bellen_band(95), "width": 10, "color": "color_2"},
            {**PANEL_LOGO, "subject": "quatrefoil"},
        ),
    ),
    CuratedExample(
        example_id="template_placement_v_split",
        name="V자 분할과 큐브 로고",
        caption="차콜 다이아 결 위에 V자로 면을 나누고 왼팔을 와인 띠가 따라간다",
        category="포인트",
        point="bottom",
        logo_slots=(("logo", "포인트 로고"),),
        color_names=("바탕", "결", "왼쪽 면", "띠", "선"),
        plan=TRENZ_PLAN,
        panel=(
            {
                "type": "region",
                "points": [[-50, 480], _TRENZ_V, [500, 1600], [-50, 1600]],
                "color": "color_2",
            },
            # 왼팔 위 와인 띠(수직 굵기 55) — 끝은 오른팔에 맞물리게 잘라 꼭짓점까지 채운다
            {
                "type": "region",
                "points": [[-50, 480], _TRENZ_V, [539, 991], [-50, 402]],
                "color": "color_3",
            },
            # 두 팔 모두 다이아 결과 같은 45°
            {
                "type": "line",
                "points": [[-50, 480], _TRENZ_V, [1050, 480]],
                "width": 8,
                "color": "color_4",
            },
            {"type": "line", "points": [_TRENZ_V, [500, 1600]], "width": 5, "color": "color_4"},
            {**PANEL_LOGO, "subject": "cube"},
        ),
    ),
    CuratedExample(
        example_id="template_placement_vine",
        name="넝쿨 가지와 C 로고",
        caption="짙은 초록 바탕 왼쪽을 따라 금색 넝쿨 가지가 한 줄기 올라간다",
        category="포인트",
        point="bottom",
        logo_slots=(("logo", "포인트 로고"),),
        color_names=("바탕", "결"),
        plan=_textured_plan("#1d3a2c", "#21412f"),
        panel=(
            {"type": "motif", "subject": "vine", "at": [210, 560], "size": 820, "rotation": -6},
            {**PANEL_LOGO, "subject": "initialc"},
        ),
    ),
    CuratedExample(
        example_id="template_placement_brush",
        name="붓 터치와 세리프 N",
        caption="네이비 바탕 위 오른쪽 위와 왼쪽 아래에 회백·블루 붓 자국이 한 번씩",
        category="포인트",
        point="bottom",
        logo_slots=(("logo", "포인트 로고"),),
        color_names=("바탕", "결"),
        plan=_textured_plan("#1b2a52", "#203060"),
        panel=(
            {"type": "motif", "subject": "brushstroke", "at": [700, 420], "size": 420},
            {
                "type": "motif",
                "subject": "brushstroke",
                "at": [170, 980],
                "size": 330,
                "rotation": 4,
            },
            {**PANEL_LOGO, "subject": "initialn"},
        ),
    ),
)


async def _resolve_panel(
    session: AsyncSession, panel: tuple[dict[str, Any], ...]
) -> list[dict[str, Any]]:
    """panel 모티프의 `subject`를 카탈로그 motif_id로 바꾼 intent 형식 목록."""
    resolved: list[dict[str, Any]] = []
    for element in panel:
        item = dict(element)
        if "subject" in item:
            item["motif_id"] = await _catalog_motif_id(session, item.pop("subject"))
        resolved.append(item)
    return resolved


def _run_id(example_id: str) -> uuid.UUID:
    return uuid.uuid5(RUN_NAMESPACE, example_id)


async def _catalog_motif_id(session: AsyncSession, subject: str) -> str:
    """subject로 공개 카탈로그에서 대표 모티프 하나를 고른다 — id 순으로 결정론."""
    motif_id = await session.scalar(
        select(Motif.id)
        .where(Motif.source == "seed", Motif.subject == subject)
        .order_by(Motif.id)
        .limit(1)
    )
    if motif_id is None:
        raise SystemExit(
            f"카탈로그에 subject={subject!r} 모티프가 없습니다 — "
            "먼저 apps/worker/scripts/seed_motifs.py를 실행하세요."
        )
    return motif_id


def _name_color_slots(intent: dict[str, Any], names: tuple[str, ...]) -> None:
    """플랜 색 순서대로 팔레트 슬롯에 부위 이름을 붙인다 — 색 고르기의 선택 부위."""
    for slot, name in zip(intent["palette"]["slots"], names, strict=False):
        slot["name"] = name


def _compose_run(
    plan: DesignPlanV3,
    *,
    motif_ids: list[str],
    catalog: dict[str, MotifDef],
    color_names: tuple[str, ...],
    panel: list[dict[str, Any]] | None = None,
    tile_scale: float = 1.0,
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """플랜 → intent → SVG. 워커 /generate의 intent 경로와 같은 순서를 지킨다.

    panel(배치형)은 플랜 계약 밖이라 컴파일된 intent에 그대로 얹는다 — motif_id로 풀린 상태여야
    하고, 그 모티프도 catalog에 있어야 한다.
    """
    authored = compile_design_plan_v3(
        plan, motif_ids=motif_ids, tile_mm=DEFAULT_TILE_MM * tile_scale, seed=SEED
    )
    warnings: list[str] = []
    intent = apply_generation_constraints(authored.intent, warnings=warnings)
    if panel:
        intent["panel"] = panel
    _name_color_slots(intent, color_names)
    resolved_plan = snapshot_resolved_plan(plan, intent)
    design = compose_design(
        intent,
        seed=SEED,
        colorway="default",
        motifs=catalog or None,
    )
    warnings.extend(design.warnings)
    intent_log = {
        "design": intent,
        "resolved_plan": resolved_plan.model_dump(mode="json"),
    }
    design_log = {
        "id": design.id,
        "layout_id": design.layout_id,
        "source_fidelity": design.source_fidelity,
        "colorway_id": design.colorway_id,
        "seed": design.seed,
        "svg": design.svg,
        "png_object_key": None,
        "panel_svg": design.panel_svg,
        "intent": design.intent.model_dump(mode="json"),
    }
    return intent_log, design_log, list(dict.fromkeys(warnings))


async def _upsert(
    session: AsyncSession,
    curated: CuratedExample,
    ordinal: int,
    *,
    intent_log: dict[str, Any],
    design_log: dict[str, Any],
    warnings: list[str],
    registry_version: str,
    engine_version: str,
) -> None:
    run_id = _run_id(curated.example_id)
    log_values = {
        "id": run_id,
        "input_type": "intent",
        "prompt": None,
        "colorway": design_log["colorway_id"],
        "seed": design_log["seed"],
        "engine_version": engine_version,
        "registry_version": registry_version,
        "intent": intent_log,
        "design": design_log,
        "warnings": warnings,
        "status": "success",
        "diagnostics": {"seeded_from": curated.example_id},
    }
    await session.execute(
        insert(SeamlessGenerationLog)
        .values(**log_values)
        .on_conflict_do_update(
            index_elements=[SeamlessGenerationLog.id],
            set_={key: value for key, value in log_values.items() if key != "id"},
        )
    )
    example_values = {
        "run_id": run_id,
        "name": curated.name,
        "caption": curated.caption,
        "ordinal": ordinal,
        "published": True,
        "category": curated.category,
        "point": curated.point,
        "logo_slots": [{"slot": slot, "label": label} for slot, label in curated.logo_slots]
        or None,
        "photo_full_url": curated.photo_full_url,
        "photo_detail_url": curated.photo_detail_url,
    }
    await session.execute(
        insert(DesignExample)
        .values(**example_values)
        .on_conflict_do_update(
            index_elements=[DesignExample.run_id],
            set_={key: value for key, value in example_values.items() if key != "run_id"},
        )
    )


async def _run() -> list[str]:
    settings = get_settings()
    engine = build_engine(settings)
    try:
        sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        async with sessionmaker() as session:
            registry_version = await registry_version_for(session)
            seeded: list[str] = []
            for ordinal, curated in enumerate(CURATED):
                plan = curated.plan
                motif_ids = [
                    await _catalog_motif_id(session, subject) for subject in curated.motif_subjects
                ]
                panel = await _resolve_panel(session, curated.panel)
                panel_ids = [item["motif_id"] for item in panel if "motif_id" in item]
                intent_log, design_log, warnings = _compose_run(
                    plan,
                    motif_ids=motif_ids,
                    catalog=await get_motifs(session, [*motif_ids, *panel_ids]),
                    color_names=curated.color_names,
                    panel=panel,
                    tile_scale=curated.tile_scale,
                )
                await _upsert(
                    session,
                    curated,
                    ordinal,
                    intent_log=intent_log,
                    design_log=design_log,
                    warnings=warnings,
                    registry_version=registry_version,
                    engine_version=settings.engine_version,
                )
                seeded.append(f"{curated.name} ({curated.example_id})")
            await session.execute(
                delete(DesignExample).where(
                    DesignExample.run_id.not_in([_run_id(item.example_id) for item in CURATED])
                )
            )
            await session.commit()
            return seeded
    finally:
        await engine.dispose()


if __name__ == "__main__":
    for line in asyncio.run(_run()):
        print(f"seeded {line}")

"""디자인 예시 갤러리 시드 — 스토어 첫 진입 큐레이션(design_examples).

예시는 run(seamless_generation_logs) 포인터만 들고 있으므로(db/models/design.py
DesignExample) 시드가 할 일은 "run 한 벌을 만들어 두는 것"이다. 여기서는 저작 모델을
부르지 않고, 이미 레포에 있는 gallery-v1 플랜을 결정론 컴파일러·엔진에 직접 통과시켜
run을 만든다 — 같은 플랜+모티프+seed면 언제나 같은 SVG라 외부 API도 과금도 없다.

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
import uuid
from dataclasses import dataclass, field
from typing import Any

from db.models.design import DesignExample
from db.models.seamless import Motif, SeamlessGenerationLog
from sqlalchemy import delete, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker
from worker.authoring.compiler import compile_design_plan_v3
from worker.authoring.examples import load_example_set
from worker.authoring.schema import DesignPlanV3, snapshot_resolved_plan
from worker.config import get_settings
from worker.db import build_engine
from worker.engine.compose import compose_design
from worker.engine.constraints import apply_generation_constraints
from worker.motifs.fingerprint import registry_version_for
from worker.motifs.registry import MotifDef
from worker.motifs.store import get_motifs

# run_id 파생 네임스페이스 — 예시 하나당 run 하나를 안정적으로 재지정한다.
RUN_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://essesion.local/design-examples")
# 골든 픽스처와 같은 앵커. 산포·경로 배치의 난수를 고정한다.
SEED = 20240


@dataclass(frozen=True)
class CuratedExample:
    """gallery-v1 플랜 하나 + 카탈로그 모티프 선택 + 카드 문구."""

    example_id: str
    name: str
    caption: str
    # 플랜의 input motif 슬롯에 순서대로 꽂을 카탈로그 subject.
    motif_subjects: tuple[str, ...] = field(default=())
    # 템플릿 데이터 — 여기가 정본이고 design_examples 컬럼은 store 전달용(DB로 관리하지 않는다).
    category: str = "그림"  # 목록 필터 칩 라벨 그대로
    point: str = "none"  # 포인트 로고 자리: none(올패턴)|top(매듭)|bottom(끝)
    logo_slot: int | None = None  # 로고가 들어갈 모티프 슬롯(1|2), None이면 서버 규칙
    # 사용자가 준비할 실사 사진 — store public/ 경로. None이면 결정론 샷을 그린다.
    photo_full_url: str | None = None
    photo_detail_url: str | None = None
    # 사용자가 고를 수 있는 부위 이름 — 플랜 `colors` 순서대로(인덱스가 같으면 같은 슬롯).
    # 이름이 붙은 슬롯만 색 고르기 화면에 나온다. 비우면 색을 바꿀 수 없는 템플릿.
    color_names: tuple[str, ...] = field(default=())
    # gallery-v1에 없는 템플릿 전용 플랜 — 있으면 example_id로 찾지 않는다(저작 few-shot 제외).
    plan: DesignPlanV3 | None = None


# 가는 세 줄 사선(핀 스트라이프 트리오)과 줄 사이의 작은 고리 모티프 — 격자 2×2가 사선 주기
# (타일당 2)와 맞물려 모티프가 항상 줄 사이 한가운데에 놓인다(밴드 묶음은 주기 0.5에 중심).
PIN_STRIPE_RINGS_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#1d3a80", "#d9d4ca"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "stripe",
                "direction": "diagonal_up",
                "period_ratio": 0.35355339,
                "bands": [
                    {"offset_ratio": 0.4467, "width_ratio": 0.02, "color_index": 1},
                    {"offset_ratio": 0.49, "width_ratio": 0.02, "color_index": 1},
                    {"offset_ratio": 0.5333, "width_ratio": 0.02, "color_index": 1},
                ],
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.11,
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


# 네이비 바탕에 로고를 하프드롭(열마다 반 칸 내림) 2×2로 깔고, diagonal_pair의 작은 점이
# 내려간 열 로고와 같은 높이(1/4·3/4)에서 로고 사이를 채운다 — 넥타이 폭에 로고 두세 개.
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
                "size_ratio": 0.2,
                "placement": {
                    "type": "lattice",
                    "columns": 2,
                    "rows": 2,
                    "drop": "half_column",
                    "fixed_rotation_deg": 0.0,
                },
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.045,
                "placement": {"type": "point_template", "template": "diagonal_pair"},
            },
        ],
    }
)


# 01 — 클래식 렙 스트라이프: 네이비 바탕에 흰 줄이 양옆을 감싼 빨간 띠를 우상향(/) 사선으로
# 촘촘히(k=3) 반복한다. 띠 묶음은 주기 0.28~0.72에 모여 원점의 작은 A 마크와 겹치지 않는다.
ALTIS_STRIPE_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#1b2a52", "#f1efe8", "#c4202e"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
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
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.07,
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


# 08 — 가로 바 스트라이프: 블루 바탕에 은색 두 줄·금색 한 줄 바를 타일당 두 번 가로로 두고,
# 바 사이(행 0·½)에 날개 엠블럼을 2×2 하프로우로 엇갈려 놓는다.
SKYLINE_WINGS_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#2a4f9e", "#c9ccd2", "#d9a441"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "stripe",
                "direction": "horizontal",
                "period_ratio": 0.5,
                "bands": [
                    {"offset_ratio": 0.40, "width_ratio": 0.03, "color_index": 1},
                    {"offset_ratio": 0.46, "width_ratio": 0.03, "color_index": 1},
                    {"offset_ratio": 0.54, "width_ratio": 0.02, "color_index": 2},
                ],
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.1,
                "placement": {
                    "type": "lattice",
                    "columns": 2,
                    "rows": 2,
                    "drop": "half_row",
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


# 04 — 네이비 바탕에 아이보리 마름모 점(가운데 진한 빨강)을 엇갈림 격자로 깐다(가로 0.5·세로 0.25
# 하프로우, 넥타이 폭에 3개). 세리프 R은 가로 경로로 점 사이 빈자리(0.25, 0)에 타일당 하나 둔다.
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
                "size_ratio": 0.12,
                "placement": {
                    "type": "path",
                    "kind": "straight",
                    "direction": "horizontal",
                    "spacing_ratio": 1.0,
                    "phase_ratio": 0.25,
                    "rotation": "fixed",
                },
            },
            {
                "type": "motif",
                "motif_index": 1,
                "size_ratio": 0.1,
                "placement": {
                    "type": "lattice",
                    "columns": 2,
                    "rows": 4,
                    "drop": "half_row",
                    "fixed_rotation_deg": 0.0,
                },
            },
        ],
    }
)


# 06 — 버건디 바탕에 타일마다 세로 스트라이프 묶음 하나(왼쪽부터 굵은 회색·아이보리·검정·회색·
# 가는 아이보리). vertical 밴드의 offset은 오른쪽에서 잰다 — 화면 순서와 반대로 적는다.
VALMONT_VERTICAL_PLAN = DesignPlanV3.model_validate(
    {
        "colors": ["#5e1620", "#8e8a88", "#e6dccb", "#1c1416"],
        "ground_color_index": 0,
        "motifs": [{"source": "input", "input_index": 1}],
        "layers": [
            {
                "type": "stripe",
                "direction": "vertical",
                "period_ratio": 1.0,
                "bands": [
                    {"offset_ratio": 0.65, "width_ratio": 0.08, "color_index": 1},
                    {"offset_ratio": 0.57, "width_ratio": 0.045, "color_index": 2},
                    {"offset_ratio": 0.495, "width_ratio": 0.04, "color_index": 3},
                    {"offset_ratio": 0.425, "width_ratio": 0.035, "color_index": 1},
                ],
            },
            {
                "type": "stripe",
                "direction": "vertical",
                "period_ratio": 1.0,
                "bands": [{"offset_ratio": 0.374, "width_ratio": 0.016, "color_index": 2}],
            },
            {
                "type": "motif",
                "motif_index": 0,
                "size_ratio": 0.12,
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


# 07 — 네이비 바탕에 아이보리 가는 줄을 양 사선(k=2)으로 겹친 큰 윈도페인 체크. 줄을 반 주기
# 밀어 타일 원점이 칸 중앙에 오게 하고, 그 칸에 십자 로고를 타일당 하나만 성기게 둔다.
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


# 10 — 검정 바탕에 한 톤 밝은 차콜 물결선 — 한 파장짜리 두 줄 물결을 3열 2행으로 이어 붙여
# 0.25 타일 간격의 연속 가로 물결을 만들고, 줄 사이 원점에 작은 물결 원 로고.
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

# 스토어 템플릿 목록 — 여기 없는 예시 행은 시드가 지운다(템플릿은 이 표가 정본).
CURATED: tuple[CuratedExample, ...] = (
    CuratedExample(
        example_id="template_stripe_pin_trio_rings",
        name="핀 스트라이프와 세 고리",
        caption="가는 세 줄 사선 사이에 놓인 작은 고리 엠블럼",
        motif_subjects=("rings",),
        category="스트라이프",
        logo_slot=1,
        color_names=("바탕", "가는 세 줄"),
        plan=PIN_STRIPE_RINGS_PLAN,
    ),
    CuratedExample(
        example_id="template_logo_halfdrop_dots",
        name="로고 하프드롭과 점",
        caption="네이비 바탕에 엇갈려 놓인 로고와 그 사이의 작은 점",
        motif_subjects=("monogram", "diamond"),
        category="로고",
        logo_slot=1,
        color_names=("바탕",),
        plan=LOGO_DOTS_PLAN,
    ),
    CuratedExample(
        example_id="template_stripe_pair_apex",
        name="흰 줄과 빨간 줄 렙 스트라이프",
        caption="네이비 바탕에 흰 줄이 감싼 빨간 띠가 촘촘히 반복되는 사선과 A 마크",
        motif_subjects=("apex",),
        category="스트라이프",
        point="bottom",
        logo_slot=1,
        color_names=("바탕", "흰 줄", "빨간 줄"),
        plan=ALTIS_STRIPE_PLAN,
    ),
    CuratedExample(
        example_id="template_stripe_sprig",
        name="잎 가지가 흐르는 사선",
        caption="차콜 바탕의 은색 두 줄과 초록 줄 사이로 작은 잎 가지가 줄지어 흐르는 무늬",
        motif_subjects=("sprig",),
        category="스트라이프",
        point="bottom",
        logo_slot=1,
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
        logo_slot=2,  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
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
        logo_slot=1,
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
        logo_slot=2,  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
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
        logo_slot=2,  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
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
        logo_slot=2,  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
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
        logo_slot=1,
        color_names=("바탕", "은색 두 줄", "금색 줄"),
        plan=SKYLINE_WINGS_PLAN,
    ),
    CuratedExample(
        example_id="template_quatrefoil_lattice_blossom",
        name="마름모 격자와 네이비 꽃",
        caption="오렌지 바탕의 가는 마름모 격자 위에 네이비 꽃과 작은 네 잎 로고",
        motif_subjects=("quatrefoil", "blossom"),
        category="패턴",
        point="bottom",
        logo_slot=1,
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
        logo_slot=2,  # 장식 레이어가 먼저 그려져 로고가 레이어 순서상 두 번째
        color_names=("바탕",),
        plan=MONOGRAM_DASH_PLAN,
    ),
    CuratedExample(
        example_id="template_dot_initial_r",
        name="세리프 R과 마름모 도트",
        caption="네이비 바탕에 빨간 심을 품은 아이보리 마름모 점이 엇갈려 놓이고 사이사이 R 이니셜",
        motif_subjects=("initialr", "rhombdot"),
        category="도트",
        point="bottom",
        logo_slot=1,
        color_names=("바탕",),
        plan=INITIAL_R_DOTS_PLAN,
    ),
    CuratedExample(
        example_id="template_initialv_vertical_stripe",
        name="세로 스트라이프와 세리프 V",
        caption="버건디 바탕에 회색·아이보리·검정 세로 줄 묶음과 아이보리 세리프 V 이니셜",
        motif_subjects=("initialv",),
        category="스트라이프",
        point="bottom",
        logo_slot=1,
        color_names=("바탕", "회색 줄", "아이보리 줄", "검정 줄"),
        plan=VALMONT_VERTICAL_PLAN,
    ),
    CuratedExample(
        example_id="template_windowpane_crosslet",
        name="윈도페인 체크와 십자 문장",
        caption="네이비 바탕에 아이보리 가는 줄이 사선으로 엇갈린 큰 체크와 칸 속 십자 문장",
        motif_subjects=("crosslet",),
        category="체크",
        point="bottom",
        logo_slot=1,
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
        logo_slot=2,  # 물결선 레이어가 먼저 그려져 로고는 레이어 순서상 두 번째
        color_names=("바탕",),
        plan=MAREN_WAVE_PLAN,
    ),
)


def plan_for(curated: CuratedExample, examples: dict[str, Any]) -> DesignPlanV3:
    return curated.plan or examples[curated.example_id].plan


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
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """플랜 → intent → SVG. 워커 /generate의 intent 경로와 같은 순서를 지킨다."""
    authored = compile_design_plan_v3(plan, motif_ids=motif_ids, seed=SEED)
    warnings: list[str] = []
    intent = apply_generation_constraints(authored.intent, warnings=warnings)
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
        # 프롬프트 없는 intent 실행 — 승격 스캔(authoring/promotion.py)의 대상이 아니다.
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
        "logo_slot": curated.logo_slot,
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
        examples = {example.example_id: example for example in load_example_set()}
        missing = [
            item.example_id
            for item in CURATED
            if item.plan is None and item.example_id not in examples
        ]
        if missing:
            raise SystemExit(f"gallery-v1에 없는 예시입니다: {', '.join(missing)}")

        sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        async with sessionmaker() as session:
            registry_version = await registry_version_for(session)
            seeded: list[str] = []
            for ordinal, curated in enumerate(CURATED):
                plan = plan_for(curated, examples)
                motif_ids = [
                    await _catalog_motif_id(session, subject) for subject in curated.motif_subjects
                ]
                intent_log, design_log, warnings = _compose_run(
                    plan,
                    motif_ids=motif_ids,
                    catalog=await get_motifs(session, motif_ids),
                    color_names=curated.color_names,
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

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
같은 행을 현재 엔진 결과로 덮어쓴다.

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
from sqlalchemy import select
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

# ponytail: 임시 실 색 표 — 정식 실 색 데이터(플랜 "실행 조건")가 오면 이 표를 그 값으로
# 바꾼다. (이름, hex). 프리셋은 바탕 하나 + 무늬 색 순서대로.
YARN = {
    "네이비": "#1B2A49",
    "블랙": "#141414",
    "버건디": "#6B1F2A",
    "포레스트": "#1F3D2B",
    "차콜": "#3A3A3C",
    "골드": "#C9A24B",
    "실버": "#B8BCC2",
    "아이보리": "#EFE9DC",
    "베이지": "#CBB79A",
    "스카이": "#7FA8D6",
}
# (바탕, 무늬 색들) — 무늬 색은 스트라이프 밴드 순서대로 돌려 쓴다.
PRESETS: tuple[tuple[str, tuple[str, ...]], ...] = (
    ("네이비", ("골드", "아이보리")),
    ("블랙", ("실버", "골드")),
    ("버건디", ("아이보리", "골드")),
    ("포레스트", ("베이지", "골드")),
    ("차콜", ("스카이", "실버")),
)


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


# 패밀리별로 하나씩 — 첫 진입 화면에서 "무엇을 만들 수 있는지"를 한 눈에 보여주는 6종.
CURATED: tuple[CuratedExample, ...] = (
    CuratedExample(
        example_id="gallery_04_stripe_diagonal_wide_band",
        name="와이드 사선 스트라이프",
        caption="굵은 대각 밴드 하나로 잡는 기본형",
        category="스트라이프",
        point="top",
    ),
    CuratedExample(
        example_id="gallery_06_motif_lattice_block",
        name="정규 격자",
        caption="어긋남 없이 규칙적으로 반복되는 격자",
        motif_subjects=("bee",),
        category="격자",
        logo_slot=1,
    ),
    CuratedExample(
        example_id="gallery_09_motif_scatter_poisson",
        name="흩뿌린 꽃",
        caption="여백을 살린 포아송 산포",
        motif_subjects=("flower",),
        logo_slot=1,
    ),
    CuratedExample(
        example_id="gallery_12_motif_path_diagonal_wave",
        name="물결을 타는 잎",
        caption="대각 물결 경로를 따라 흐르는 모티프",
        motif_subjects=("leaf",),
        logo_slot=1,
    ),
    CuratedExample(
        example_id="gallery_17_stripe_motif_guard_bands",
        name="가드 밴드 앵커",
        caption="가드 밴드 두 줄이 감싼 중심 레인 위의 엠블럼",
        motif_subjects=("anchor",),
        category="스트라이프",
        point="bottom",
        logo_slot=1,
    ),
    CuratedExample(
        example_id="gallery_21_motif_lattice_bee_circle",
        name="도트와 격자 듀오",
        caption="작은 점 격자 위에 얹은 큰 모티프",
        # 순서 = 플랜의 input 슬롯 순서: 1번이 작은 점 격자, 2번이 큰 격자 모티프.
        motif_subjects=("circle", "bee"),
        category="도트",
        logo_slot=2,
    ),
)


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


def _referenced_slots(intent: dict[str, Any]) -> list[str]:
    """레이어가 실제로 쓰는 색 슬롯 — 바탕이 먼저, 그다음 스트라이프 밴드 순서.

    모티프 레이어는 슬롯을 참조하지 않는다(모티프 고유 색 유지). 참조 안 된 슬롯은
    프리셋에서 원래 hex를 그대로 둔다.
    """
    ordered: list[str] = []
    for layer in intent.get("layers", []):
        params = layer.get("params", {})
        if layer.get("type") == "background":
            ordered.append(params["color"])
        elif layer.get("type") == "stripe":
            ordered.extend(band["color"] for band in params.get("bands", []))
    return list(dict.fromkeys(ordered))


def _rough_colorways(intent: dict[str, Any]) -> list[dict[str, Any]]:
    """기본 colorway 뒤에 임시 실 색 프리셋을 붙인다 — 색 선택 화면의 선택지."""
    slots = {slot["id"]: slot["hex"] for slot in intent["palette"]["slots"]}
    referenced = _referenced_slots(intent)
    ground = referenced[0] if referenced else None
    accents = referenced[1:]
    colorways = [cw for cw in intent.get("colorways", []) if cw.get("id") == "default"]
    for index, (bg, pattern) in enumerate(PRESETS):
        mapping = dict(slots)
        if ground is not None:
            mapping[ground] = YARN[bg]
        for i, slot in enumerate(accents):
            mapping[slot] = YARN[pattern[i % len(pattern)]]
        names = [bg, *pattern[: max(1, len(accents))]] if accents else [bg]
        colorways.append(
            {"id": f"preset_{index + 1}", "name": " · ".join(names), "mapping": mapping}
        )
    return colorways


def _compose_run(
    plan: DesignPlanV3,
    *,
    motif_ids: list[str],
    catalog: dict[str, MotifDef],
) -> tuple[dict[str, Any], dict[str, Any], list[str]]:
    """플랜 → intent → SVG. 워커 /generate의 intent 경로와 같은 순서를 지킨다."""
    authored = compile_design_plan_v3(plan, motif_ids=motif_ids, seed=SEED)
    warnings: list[str] = []
    intent = apply_generation_constraints(authored.intent, warnings=warnings)
    intent["colorways"] = _rough_colorways(intent)
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
        missing = [item.example_id for item in CURATED if item.example_id not in examples]
        if missing:
            raise SystemExit(f"gallery-v1에 없는 예시입니다: {', '.join(missing)}")

        sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
        async with sessionmaker() as session:
            registry_version = await registry_version_for(session)
            seeded: list[str] = []
            for ordinal, curated in enumerate(CURATED):
                plan = examples[curated.example_id].plan
                motif_ids = [
                    await _catalog_motif_id(session, subject) for subject in curated.motif_subjects
                ]
                intent_log, design_log, warnings = _compose_run(
                    plan,
                    motif_ids=motif_ids,
                    catalog=await get_motifs(session, motif_ids),
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
            await session.commit()
            return seeded
    finally:
        await engine.dispose()


if __name__ == "__main__":
    for line in asyncio.run(_run()):
        print(f"seeded {line}")

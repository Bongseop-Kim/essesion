"""템플릿 후보 렌더 하네스 — DB는 읽기만, 레포 파일은 건드리지 않는다.

usage (레포 루트에서):
  uv run python .claude/skills/tie-template/scripts/render.py <candidate.py> <out_prefix>

candidate.py 정의:
  PLAN: dict    # DesignPlanV3 형식
  MOTIFS: list  # 플랜 input 슬롯 순서. ("seed", "<subject>") 또는 ("new", "<subject>", "<raw svg>")
출력: <out_prefix>.svg, <out_prefix>_tile.png(타일 1장), <out_prefix>_2x2.png(2×2 반복).
스토어 평면 카드의 넥타이 폭 ≈ 1.5타일 — 2×2 이미지 폭의 3/4이 넥타이 한 폭이다.
"""

import asyncio
import importlib.util
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]


def _load(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


seed = _load("seed_design_examples", ROOT / "apps/worker/scripts/seed_design_examples.py")

from db.models.seamless import Motif  # noqa: E402
from sqlalchemy import select  # noqa: E402
from sqlalchemy.ext.asyncio import async_sessionmaker  # noqa: E402
from worker.authoring.schema import DesignPlanV3  # noqa: E402
from worker.config import get_settings  # noqa: E402
from worker.db import build_engine  # noqa: E402
from worker.motifs.normalize import normalize_motif_svg  # noqa: E402
from worker.motifs.store import get_motifs  # noqa: E402

cand = _load("cand", Path(sys.argv[1]).resolve())
out = sys.argv[2]


async def main() -> None:
    plan = DesignPlanV3.model_validate(cand.PLAN)
    engine = build_engine(get_settings())
    catalog, ids = {}, []
    async with async_sessionmaker(engine)() as session:
        for motif in cand.MOTIFS:
            if motif[0] == "seed":
                motif_id = await session.scalar(
                    select(Motif.id)
                    .where(Motif.source == "seed", Motif.subject == motif[1])
                    .order_by(Motif.id)
                    .limit(1)
                )
                assert motif_id, f"no seed motif {motif[1]}"
                catalog.update(await get_motifs(session, [motif_id]))
            else:
                normalized = normalize_motif_svg(motif[2], id_prefix="seed", render_check=False)
                motif_id = normalized.id
                catalog[motif_id] = normalized
            ids.append(motif_id)
    await engine.dispose()
    _, design, warnings = seed._compose_run(plan, motif_ids=ids, catalog=catalog, color_names=())
    print("warnings:", warnings)
    svg = design["svg"]
    Path(out + ".svg").write_text(svg)
    subprocess.run(["rsvg-convert", "-w", "500", out + ".svg", "-o", out + "_tile.png"], check=True)
    inner = svg.split(">", 1)[1].rsplit("</svg>", 1)[0]
    view_box = re.search(r'viewBox="([^"]+)"', svg).group(1).split()  # type: ignore[union-attr]
    w, h = float(view_box[2]), float(view_box[3])
    tiles = "".join(
        f'<svg x="{x * w}" y="{y * h}" width="{w}" height="{h}" viewBox="{" ".join(view_box)}">'
        f"{inner}</svg>"
        for x in (0, 1)
        for y in (0, 1)
    )
    Path(out + "_2x2.svg").write_text(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" '
        f'viewBox="0 0 {2 * w} {2 * h}">{tiles}</svg>'
    )
    subprocess.run(
        ["rsvg-convert", "-w", "700", out + "_2x2.svg", "-o", out + "_2x2.png"], check=True
    )
    print("ok", out + "_tile.png", out + "_2x2.png")


asyncio.run(main())

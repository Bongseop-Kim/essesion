"""모티프 시드 카탈로그 — 데모용 재사용 풀 (worker-motifs.md §9).

모티프 5개(flower/whole ×3, leaf/whole ×2, 전부 style=flat, source="seed", 단색 → s0):
variant pool ≥ 2를 시연한다. 멱등 — content-hash id + ON CONFLICT DO NOTHING이라 여러 번
실행해도 안전. render_check는 끈다(librsvg 없는 환경에서도 결정론적으로 시드).

실행: docker compose up -d && uv run alembic -c db/alembic.ini upgrade head
      && uv run python apps/worker/scripts/seed_motifs.py
"""

import asyncio

from sqlalchemy.ext.asyncio import async_sessionmaker
from worker.config import get_settings
from worker.db import build_engine
from worker.motifs import store
from worker.motifs.normalize import normalize_motif_svg

# 단색(single fill) 벡터 도형 — 각기 다른 geometry라 content-hash id가 서로 다르지만
# (subject, scope)가 같아 variant_group은 공유된다(풀 시연).
_SEEDS: list[tuple[str, str, str]] = [
    (
        "flower",
        "5-petal solid flower",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#c0392b" d="M50 15 L61 40 L88 40 L66 57 L74 84 L50 68 '
        'L26 84 L34 57 L12 40 L39 40 Z"/></svg>',
    ),
    (
        "flower",
        "6-petal rounded flower",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<circle cx="50" cy="50" r="12" fill="#c0392b"/>'
        '<circle cx="50" cy="26" r="10" fill="#c0392b"/>'
        '<circle cx="50" cy="74" r="10" fill="#c0392b"/>'
        '<circle cx="29" cy="38" r="10" fill="#c0392b"/>'
        '<circle cx="71" cy="38" r="10" fill="#c0392b"/>'
        '<circle cx="29" cy="62" r="10" fill="#c0392b"/>'
        '<circle cx="71" cy="62" r="10" fill="#c0392b"/></svg>',
    ),
    (
        "flower",
        "simple daisy",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<ellipse cx="50" cy="24" rx="7" ry="16" fill="#e67e22"/>'
        '<ellipse cx="50" cy="76" rx="7" ry="16" fill="#e67e22"/>'
        '<ellipse cx="24" cy="50" rx="16" ry="7" fill="#e67e22"/>'
        '<ellipse cx="76" cy="50" rx="16" ry="7" fill="#e67e22"/>'
        '<circle cx="50" cy="50" r="10" fill="#e67e22"/></svg>',
    ),
    (
        "leaf",
        "pointed leaf",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#27ae60" d="M50 10 C74 30 74 70 50 90 C26 70 26 30 50 10 Z"/></svg>',
    ),
    (
        "leaf",
        "rounded leaf",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#27ae60" d="M20 50 C20 25 45 20 55 20 C55 45 45 80 20 50 Z"/></svg>',
    ),
]


async def seed_motifs() -> int:
    settings = get_settings()
    engine = build_engine(settings)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    inserted = 0
    async with sessionmaker() as session:
        for subject, description, svg in _SEEDS:
            normalized = normalize_motif_svg(svg, render_check=False)
            await store.upsert_motif(
                session,
                normalized,
                facets={
                    "subject": subject,
                    "scope": "whole",
                    "style": "flat",
                    "description": description,
                },
                source="seed",
                variant_group=store.variant_group_key(subject, "whole"),
            )
            inserted += 1
        await session.commit()
    await engine.dispose()
    return inserted


if __name__ == "__main__":
    count = asyncio.run(seed_motifs())
    print(f"seeded {count} motifs (idempotent)")

"""모티프 시드 카탈로그 — 데모용 재사용 풀 (worker-motifs.md §9).

인라인 5개(flower/whole ×3, leaf/whole ×2, style=flat)로 variant pool ≥ 2를 시연하고,
`motif_assets/*.svg`(Flaticon UIcons regular-rounded 웹폰트에서 추출한 글리프 —
동물·마린·하늘·문장·과일·취미·식물, subject = 파일명 첫 토큰, style=outline)를
기본 모티프로 얹는다. 전부 source="seed", 단색 → s0.
멱등 — content-hash id + ON CONFLICT DO NOTHING이라 여러 번 실행해도 안전.
render_check는 끈다(librsvg 없는 환경에서도 결정론적으로 시드).

실행: docker compose up -d && uv run alembic -c db/alembic.ini upgrade head
      && uv run python apps/worker/scripts/seed_motifs.py
"""

import asyncio
import pathlib

from db.models.seamless import Motif
from sqlalchemy import update
from sqlalchemy.ext.asyncio import async_sessionmaker
from worker.config import get_settings
from worker.db import build_engine
from worker.motifs import store
from worker.motifs.normalize import normalize_motif_svg

# 한글 프롬프트 어휘 매칭용 subject→한글어(들). 검색은 exact-token 교집합이라
# subject가 영어인 시드는 한글 tag 없이는 절대 안 잡힌다(worker-motifs.md §5, tau 벡터 경로는 미달).
_KO_TAGS: dict[str, list[str]] = {
    "anchor": ["닻"],
    "badger": ["오소리"],
    "bat": ["박쥐"],
    "bee": ["꿀벌", "벌"],
    "bicycle": ["자전거"],
    "bird": ["새"],
    "butterfly": ["나비"],
    "cat": ["고양이"],
    "cherry": ["체리", "버찌"],
    "chess": ["체스"],
    "circle": ["원", "동그라미"],
    "cloud": ["구름"],
    "clover": ["클로버", "토끼풀"],
    "cow": ["소", "젖소"],
    "crab": ["게"],
    "crow": ["까마귀"],
    "crown": ["왕관"],
    "deer": ["사슴"],
    # "개"(dog)는 한국어 최빈 단위 명사("N 개")와 동형이라 카탈로그 grounding에서 계수 표현을
    # dog으로 오매칭시킨다("두 개의 밴드"→개). 강아지로 충분히 grounding되므로 계수어 동형은 뺀다.
    "dog": ["강아지"],
    "dolphin": ["돌고래"],
    "dove": ["비둘기"],
    "dragon": ["용"],
    "duck": ["오리"],
    "elephant": ["코끼리"],
    "fish": ["물고기", "생선"],
    "flower": ["꽃", "플라워"],
    "fox": ["여우"],
    "frog": ["개구리"],
    "golf": ["골프"],
    "grape": ["포도"],
    "hippo": ["하마"],
    "horse": ["말"],
    "key": ["열쇠"],
    "kiwi": ["키위"],
    "leaf": ["잎", "나뭇잎"],
    "lemon": ["레몬"],
    "lion": ["사자"],
    "lobster": ["랍스터", "바닷가재"],
    "monkey": ["원숭이"],
    "moon": ["달"],
    "mosquito": ["모기"],
    "mouse": ["쥐", "생쥐"],
    "music": ["음악", "음표"],
    "narwhal": ["일각고래"],
    "otter": ["수달"],
    "paw": ["발바닥", "발자국"],
    "pelican": ["펠리컨"],
    "pig": ["돼지"],
    "plane": ["비행기"],
    "rabbit": ["토끼"],
    "raccoon": ["너구리"],
    "sailboat": ["요트", "돛단배"],
    "sheep": ["양"],
    "shield": ["방패"],
    "ship": ["배", "선박"],
    "shrimp": ["새우"],
    "snake": ["뱀"],
    "snowflake": ["눈송이", "눈꽃"],
    "spider": ["거미"],
    "squid": ["오징어"],
    "squirrel": ["다람쥐"],
    "star": ["별"],
    "strawberry": ["딸기"],
    "sun": ["태양", "해"],
    "tennis": ["테니스"],
    "turtle": ["거북이", "거북"],
    "unicorn": ["유니콘"],
    "whale": ["고래"],
    "worm": ["지렁이", "벌레"],
}

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


# 출처: https://github.com/freepik-company/flaticon-uicons (Flaticon license) —
# uicons-regular-rounded 웹폰트 글리프를 SVG path로 추출해 커밋한 것.
_ASSET_DIR = pathlib.Path(__file__).parent / "motif_assets"


def _all_seeds() -> list[tuple[str, str, str, list[str], str]]:
    """(subject, style, description, tags, raw_svg) — 인라인 데모 + 에셋 글리프.

    에셋 subject = 파일명 첫 토큰 — `cat-head`·`cat-space`가 `cat`으로 묶여
    variant pool을 이룬다(leaf/flower는 인라인 시드 풀에 합류).
    """
    seeds = [
        (subject, "flat", desc, [subject, *_KO_TAGS.get(subject, [])], svg)
        for subject, desc, svg in _SEEDS
    ]
    seeds += [
        (
            subject := path.stem.split("-")[0],
            "outline",
            f"{path.stem.replace('-', ' ')} outline icon",
            list(dict.fromkeys([path.stem, *path.stem.split("-"), *_KO_TAGS.get(subject, [])])),
            path.read_text(),
        )
        for path in sorted(_ASSET_DIR.glob("*.svg"))
    ]
    return seeds


async def seed_motifs() -> int:
    settings = get_settings()
    engine = build_engine(settings)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    inserted = 0
    async with sessionmaker() as session:
        for subject, style, description, tags, svg in _all_seeds():
            normalized = normalize_motif_svg(svg, render_check=False)
            await store.upsert_motif(
                session,
                normalized,
                facets={
                    "subject": subject,
                    "scope": "whole",
                    "style": style,
                    "description": description,
                    "tags": tags,
                },
                source="seed",
                variant_group=store.variant_group_key(subject, "whole"),
            )
            # upsert는 ON CONFLICT DO NOTHING이라 기존 행 tags를 갱신하지 않는다.
            # 한글 tag 백필을 위해 시드 행 tags는 의도값으로 명시 재기록한다(멱등).
            await session.execute(
                update(Motif).where(Motif.id == normalized.id).values(tags=tags)
            )
            inserted += 1
        await session.commit()
    await engine.dispose()
    return inserted


if __name__ == "__main__":
    count = asyncio.run(seed_motifs())
    print(f"seeded {count} motifs (idempotent)")

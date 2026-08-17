"""모티프 검색 어휘 — 시드가 심고 resolver가 tier를 가르는 공유 정본 (worker-motifs.md §9).

subject가 영어인 시드는 한글 tag 없이는 exact-token 교집합에 절대 안 잡히고, 카테고리
상위어("운동"·"과일"·"하늘") 없이는 시트의 브라우징 칩이 전부 0건이다. 카테고리는 스키마
컬럼이 아니라 태그다.

`CATEGORY_WORDS`를 resolver가 아는 이유는 상위어가 수십 건을 한 번에 끌어오기 때문이다 —
고유어와 같은 층에 두면 유사도 순위를 가진 벡터 결과를 밀어내므로 폴백 tier로 내린다.

store 시트의 칩(`apps/store/src/features/design/model/motif-categories.ts`)이 여기 한글어와
**같은 문자열**을 쓴다 — 어긋나면 칩을 눌렀는데 0건이 나온다.
"""

from __future__ import annotations

# subject → 한글 동의어. 첫 항목이 카드 라벨이 된다(api `_motif_label`)이라 상위어보다 앞선다.
KO_TAGS: dict[str, list[str]] = {
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

# english key → (한글어, subject들). key와 한글어가 모두 그대로 tag가 된다.
# 버킷은 겹치되(kiwi=새+과일, ship=바다+탈것) 대체로 나뉜다. "동물"은 육상·상상 동물만 담는다 —
# 새·물고기·곤충은 한국어에서 각자 상위어가 있고, 동물이 카탈로그를 다 끌어오면 칩으로 못 쓴다.
CATEGORIES: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "animal": (
        ("동물",),
        (
            "badger",
            "bat",
            "cat",
            "cow",
            "deer",
            "dog",
            "dragon",
            "elephant",
            "fox",
            "frog",
            "hippo",
            "horse",
            "lion",
            "monkey",
            "mouse",
            "otter",
            "paw",
            "pig",
            "rabbit",
            "raccoon",
            "sheep",
            "snake",
            "squirrel",
            "turtle",
            "unicorn",
        ),
    ),
    "bird": (("새", "조류"), ("bird", "crow", "dove", "duck", "kiwi", "pelican")),
    "sea": (
        ("바다", "해양"),
        (
            "anchor",
            "crab",
            "dolphin",
            "fish",
            "lobster",
            "narwhal",
            "sailboat",
            "ship",
            "shrimp",
            "squid",
            "turtle",
            "whale",
        ),
    ),
    "insect": (("곤충", "벌레"), ("bee", "butterfly", "mosquito", "spider", "worm")),
    "plant": (("식물",), ("clover", "flower", "leaf")),
    "fruit": (("과일",), ("cherry", "grape", "kiwi", "lemon", "strawberry")),
    "sport": (("스포츠", "운동"), ("bicycle", "chess", "golf", "tennis")),
    "vehicle": (("탈것", "교통"), ("bicycle", "plane", "sailboat", "ship")),
    "sky": (("하늘", "날씨"), ("cloud", "moon", "snowflake", "star", "sun")),
    "symbol": (("상징", "문장"), ("anchor", "circle", "crown", "key", "shield")),
    "music": (("음악",), ("music",)),
}


def _vocab_by_subject() -> dict[str, list[str]]:
    """subject → [한글 동의어…, 카테고리어…] — 순서가 계약이다(고유어 먼저)."""
    vocab = {subject: list(korean) for subject, korean in KO_TAGS.items()}
    for category, (korean, subjects) in CATEGORIES.items():
        for subject in subjects:
            vocab.setdefault(subject, []).extend([category, *korean])
    return vocab


VOCAB_BY_SUBJECT: dict[str, list[str]] = _vocab_by_subject()

# 태그 하나가 카테고리(상위어)인지 판정하는 집합 — resolver의 tier 분리가 이걸 쓴다.
CATEGORY_WORDS: frozenset[str] = frozenset(
    word for category, (korean, _) in CATEGORIES.items() for word in (category, *korean)
)

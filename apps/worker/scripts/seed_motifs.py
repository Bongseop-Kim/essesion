"""모티프 시드 카탈로그 — 데모용 재사용 풀 (worker-motifs.md §9).

인라인 5개(flower/whole ×3, leaf/whole ×2, style=flat)로 variant pool ≥ 2를 시연하고,
`motif_assets/*.svg`(Flaticon UIcons regular-rounded 웹폰트에서 추출한 글리프 —
동물·마린·하늘·문장·과일·취미·식물, subject = 파일명 첫 토큰, style=outline)를
기본 모티프로 얹는다. 전부 source="seed", status="approved"이며 SVG의 concrete 색을 그대로 보존한다.
멱등 — content-hash id + ON CONFLICT DO NOTHING이라 여러 번 실행해도 안전.
render_check는 끈다(librsvg 없는 환경에서도 결정론적으로 시드).

실행: docker compose up -d && uv run alembic -c db/alembic.ini upgrade head
      && uv run python apps/worker/scripts/seed_motifs.py
"""

import asyncio
import pathlib
from typing import cast

from db.models.seamless import Motif
from sqlalchemy import CursorResult, update
from sqlalchemy.ext.asyncio import async_sessionmaker
from worker.config import get_settings
from worker.db import build_engine
from worker.motifs import store
from worker.motifs.categories import VOCAB_BY_SUBJECT
from worker.motifs.normalize import normalize_motif_svg

# 단색(single fill) 벡터 도형 — 각기 다른 geometry라 content-hash id가 서로 다르다.
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
    # 손으로 쓴 원반 — 글리프가 아니라 여기 산다. motif_assets에 두면 파일명 템플릿이
    # "circle outline icon"/style=outline로 라벨을 붙여 실물(단색 원반)과 어긋난다.
    (
        "circle",
        "solid disc",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        '<circle cx="12" cy="12" r="12" fill="#c0445a"/></svg>',
    ),
    # 세 고리 — 은·연두·하늘 고리가 맞물린 작은 엠블럼(핀 스트라이프 템플릿의 기본 모티프).
    # 안쪽 원을 반대 방향으로 그려 fill-rule과 무관하게 구멍이 난다.
    (
        "rings",
        "three interlocking rings in silver, green and cyan",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#c9c5bd" d="M16 38a20 20 0 1 1 40 0a20 20 0 1 1 -40 0Z'
        'M24 38a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z"/>'
        '<path fill="#8cc63f" d="M44 38a20 20 0 1 1 40 0a20 20 0 1 1 -40 0Z'
        'M52 38a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z"/>'
        '<path fill="#3bbfe0" d="M30 62a20 20 0 1 1 40 0a20 20 0 1 1 -40 0Z'
        'M38 62a12 12 0 1 0 24 0a12 12 0 1 0 -24 0Z"/></svg>',
    ),
    # 두 획 마크 — 베이지 Λ에 파란 사선이 걸친 로고 자리 표시(로고 하프드롭 템플릿의 기본 모티프).
    (
        "monogram",
        "beige and blue two-stroke letter mark",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#d8c7a8" d="M12 88 L26 88 L52 18 L40 12 Z M40 12 L52 18 L74 88 L60 88 Z"/>'
        '<path fill="#4f7fc4" d="M46 56 L58 62 L90 14 L78 10 Z"/></svg>',
    ),
    # 작은 마름모 — 로고 사이를 채우는 점.
    (
        "diamond",
        "small solid diamond",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        '<path fill="#d8c7a8" d="M12 0 L24 12 L12 24 L0 12 Z"/></svg>',
    ),
    # 기하학 A 마크 — 아이보리 A에 가로획과 꼭대기 삼각 장식(흰·빨간 사선 템플릿의 로고 자리 표시).
    (
        "apex",
        "ivory geometric letter a mark",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#e4e0d6" d="M50 6 L92 94 L78 94 L50 34 L22 94 L8 94 Z'
        'M34 70 L66 70 L71 80 L29 80 Z"/>'
        '<path fill="#e4e0d6" d="M50 22 L58 40 L42 40 Z"/></svg>',
    ),
    # 세 잎 가지 — 가운데 잎과 양옆 잎, 줄기로 된 아이보리 심볼(은빛 사선 템플릿의 로고 자리 표시).
    (
        "sprig",
        "ivory three-leaf sprig symbol",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#d9d6cf" d="M50 6 C62 20 62 40 50 54 C38 40 38 20 50 6 Z'
        "M46 58 C30 58 16 48 10 32 C26 32 40 40 46 58 Z"
        "M54 58 C60 40 74 32 90 32 C84 48 70 58 54 58 Z"
        'M47 56 L53 56 L53 94 L47 94 Z"/></svg>',
    ),
    # 육각 엠블럼 — 금빛 육각 테두리 안에 세리프 H(엠블럼 꽃문양 템플릿의 로고 자리 표시).
    # 안쪽 육각형은 반대 방향으로 그려서 테두리만 남긴다.
    (
        "hexagon",
        "gold hexagon outline emblem with a serif letter H",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#e3cf9c" d="M50 3 L90.7 26.5 L90.7 73.5 L50 97 L9.3 73.5 L9.3 26.5 Z'
        "M50 11 L16.2 30.5 L16.2 69.5 L50 89 L83.8 69.5 L83.8 30.5 Z"
        "M30 30 L46 30 L46 34 L42 34 L42 47 L58 47 L58 34 L54 34 L54 30 L70 30 L70 34 L66 34 "
        "L66 66 L70 66 L70 70 L54 70 L54 66 L58 66 L58 53 L42 53 L42 66 L46 66 L46 70 L30 70 "
        'L30 66 L34 66 L34 34 L30 34 Z"/></svg>',
    ),
    # 꽃문양 — 네 꽃잎이 십자로 뻗고 대각선에 점이 박힌 흰 꽃문양, 가운데에 남색 점.
    (
        "fleur",
        "white four-petal fleuron with a navy center",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#f3eee4" d="M50 4 C61 22 60 34 50 44 C40 34 39 22 50 4 Z'
        "M96 50 C78 61 66 60 56 50 C66 40 78 39 96 50 Z"
        "M50 96 C39 78 40 66 50 56 C60 66 61 78 50 96 Z"
        'M4 50 C22 39 34 40 44 50 C34 60 22 61 4 50 Z"/>'
        '<circle cx="31" cy="31" r="5" fill="#f3eee4"/>'
        '<circle cx="69" cy="31" r="5" fill="#f3eee4"/>'
        '<circle cx="31" cy="69" r="5" fill="#f3eee4"/>'
        '<circle cx="69" cy="69" r="5" fill="#f3eee4"/>'
        '<circle cx="50" cy="50" r="6" fill="#26305e"/></svg>',
    ),
    # 원 속 물결 세 줄 — 안쪽 원을 반대 방향으로 그려 고리를 낸다(레지멘탈 템플릿 로고 자리).
    (
        "wave",
        "ivory circle emblem with three wave lines",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#e9e6df" d="M4 50a46 46 0 1 1 92 0a46 46 0 1 1 -92 0Z'
        "M11 50a39 39 0 1 0 78 0a39 39 0 1 0 -78 0Z"
        "M22 30C31.33 22 40.67 22 50 30C59.33 38 68.67 38 78 30L78 37"
        "C68.67 45 59.33 45 50 37C40.67 29 31.33 29 22 37Z"
        "M15 45C26.67 37 38.33 37 50 45C61.67 53 73.33 53 85 45L85 52"
        "C73.33 60 61.67 60 50 52C38.33 44 26.67 44 15 52Z"
        "M18 60C28.67 52 39.33 52 50 60C60.67 68 71.33 68 82 60L82 67"
        'C71.33 75 60.67 75 50 67C39.33 59 28.67 59 18 67Z"/></svg>',
    ),
    # 나무 심볼 — 둥근 수관에 가지를 구멍으로 뚫어 바탕색이 비친다(메달리온 템플릿 로고 자리).
    (
        "tree",
        "ivory round tree symbol with cut-out branches",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#efe6cc" d="M50.0 68.0A12.7 12.7 0 0 1 30.7 61.0A12.7 12.7 0 0 1 20.5 43.2'
        "A12.7 12.7 0 0 1 24.0 23.0A12.7 12.7 0 0 1 39.7 9.8A12.7 12.7 0 0 1 60.3 9.8"
        "A12.7 12.7 0 0 1 76.0 23.0A12.7 12.7 0 0 1 79.5 43.2A12.7 12.7 0 0 1 69.3 61.0"
        "A12.7 12.7 0 0 1 50.0 68.0Z"
        "M48.5 60 L51.5 60 L51.5 42 L61 32 L59 30 L51.5 37.5 L51.5 20 L48.5 20 L48.5 37.5"
        " L41 30 L39 32 L48.5 42Z"
        "M48.5 52 L35 41 L33.5 43 L48.5 56Z"
        "M51.5 56 L66.5 43 L65 41 L51.5 52Z"
        'M46 64L54 64L55 84L64 92L72 92L72 96L28 96L28 92L36 92L45 84Z"/></svg>',
    ),
    # 마름모 메달리온 — 금빛 마름모 테두리와 네 꼭짓점 점 안에 아이보리 사엽 꽃, 금빛 꽃술.
    (
        "medallion",
        "gold diamond medallion with ivory quatrefoil",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#c9a961" d="M50 12 L88 50 L50 88 L12 50 Z M50 20 L20 50 L50 80 L80 50 Z'
        "M50 0a4 4 0 1 1 0 8a4 4 0 1 1 0 -8Z M50 92a4 4 0 1 1 0 8a4 4 0 1 1 0 -8Z"
        'M0 50a4 4 0 1 1 8 0a4 4 0 1 1 -8 0Z M92 50a4 4 0 1 1 8 0a4 4 0 1 1 -8 0Z"/>'
        '<path fill="#efe6cc" d="M50 30a10 10 0 1 1 0 20a10 10 0 1 1 0 -20Z'
        "M50 50a10 10 0 1 1 0 20a10 10 0 1 1 0 -20Z"
        "M30 50a10 10 0 1 1 20 0a10 10 0 1 1 -20 0Z"
        'M50 50a10 10 0 1 1 20 0a10 10 0 1 1 -20 0Z"/>'
        '<path fill="#c9a961" d="M50 45a5 5 0 1 1 0 10a5 5 0 1 1 0 -10Z"/></svg>',
    ),
    # 아이소메트릭 육각 큐브 윤곽 — 실버 엠블럼(마름모 묶음 템플릿의 로고 자리 표시).
    (
        "cube",
        "silver isometric hexagon cube outline",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#d4d7de" d="M50.0 6.0 L88.1 28.0 L88.1 72.0 L50.0 94.0 '
        "L11.9 72.0 L11.9 28.0 Z "
        'M18.0 31.5 L18.0 68.5 L50.0 87.0 L82.0 68.5 L82.0 31.5 L50.0 13.0 Z"/>'
        '<path fill="#d4d7de" d="M51.5 52.6 L87.0 32.1 L84.0 26.9 L48.5 47.4 Z"/>'
        '<path fill="#d4d7de" d="M51.5 47.4 L16.0 26.9 L13.0 32.1 L48.5 52.6 Z"/>'
        '<path fill="#d4d7de" d="M47.0 50.0 L47.0 91.0 L53.0 91.0 L53.0 50.0 Z"/></svg>',
    ),
    # 마름모 넷이 큰 마름모를 이루는 묶음 — 윗면 밝은 파랑, 아랫면 짙은 파랑의 두 톤.
    (
        "cluster",
        "four small two-tone blue diamonds forming a larger diamond",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#6f9be0" d="M50 2 L72 24 L28 24 Z"/>'
        '<path fill="#3a68b8" d="M28 24 L72 24 L50 46 Z"/>'
        '<path fill="#6f9be0" d="M24 28 L46 50 L2 50 Z"/>'
        '<path fill="#3a68b8" d="M2 50 L46 50 L24 72 Z"/>'
        '<path fill="#6f9be0" d="M76 28 L98 50 L54 50 Z"/>'
        '<path fill="#3a68b8" d="M54 50 L98 50 L76 72 Z"/>'
        '<path fill="#6f9be0" d="M50 54 L72 76 L28 76 Z"/>'
        '<path fill="#3a68b8" d="M28 76 L72 76 L50 98 Z"/></svg>',
    ),
    # 세리프 R — 크림색 대문자 R(체크 템플릿의 로고 자리 표시). 안쪽 고리는 반대 방향 서브패스.
    (
        "serif",
        "cream serif capital letter R mark",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#f1e7d3" d="M30 18 H42 V82 H30 Z M18 12 H44 V19 H18 Z M18 81 H54 V88 H18 Z'
        "M40 12 H58 C77 12 84 22 84 31 C84 41 76 50 58 50 H40 Z"
        "M42 20 V42 H56 C66 42 71 38 71 31 C71 24 66 20 56 20 Z"
        'M50 47 H63 L82 82 H69 Z M62 81 H90 V88 H62 Z"/></svg>',
    ),
    # 진한 빨강 마름모 — 다이아 체크에서 두 사선 밴드가 겹치는 칸.
    (
        "harlequin",
        "dark red diamond check cell",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        '<path fill="#7d0f1c" d="M12 0 L24 12 L12 24 L0 12 Z"/></svg>',
    ),
    # 겹친 날개 바 — 아래로 좁아지는 세 겹 셰브런 심볼(날개 사선 템플릿의 로고 자리 표시).
    (
        "wings",
        "three stacked silver chevron wing bars",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#e4e6ea" d="M4 26 L96 26 L86 37 L57 37 L50 44 L43 37 L14 37 Z'
        "M17 43 L83 43 L74 53 L57 53 L50 60 L43 53 L26 53 Z"
        'M30 59 L70 59 L50 78 Z"/></svg>',
    ),
    # 네 잎 심볼 — 뾰족한 꽃잎 네 장과 가운데 작은 마름모(마름모 격자 템플릿의 로고 자리 표시).
    (
        "quatrefoil",
        "cream four-petal leaf symbol",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="#f1e6cf" d="'
        "M50 4 C68 18 66 34 50 46 C34 34 32 18 50 4Z"
        "M96 50 C82 68 66 66 54 50 C66 34 82 32 96 50Z"
        "M50 96 C32 82 34 66 50 54 C66 66 68 82 50 96Z"
        "M4 50 C18 32 34 34 46 50 C34 66 18 68 4 50Z"
        'M50 44 L56 50 L50 56 L44 50Z"/></svg>',
    ),
    # 둥근 네 꽃잎 네이비 꽃과 크림 꽃심 — 격자 교차점에 놓이는 장식.
    (
        "blossom",
        "small navy four-petal flower with cream center",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#1f2a5c" d="M50 6a17 17 0 1 1 0 34a17 17 0 1 1 0-34Z'
        " M50 60a17 17 0 1 1 0 34a17 17 0 1 1 0-34Z"
        "M6 50a17 17 0 1 1 34 0a17 17 0 1 1-34 0Z M60 50a17 17 0 1 1 34 0a17 17 0 1 1-34 0Z"
        'M50 30a20 20 0 1 1 0 40a20 20 0 1 1 0-40Z"/>'
        '<path fill="#f1e6cf" d="M50 41a9 9 0 1 1 0 18a9 9 0 1 1 0-18Z"/></svg>',
    ),
    # M 모노그램 — 두 기둥에 V를 걸고 위아래에 세리프 막대를 단 은빛 마크(점선 템플릿 로고 자리).
    (
        "emblem",
        "silver serif letter M monogram",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#c9ced8" d="M18 18 L28 18 L28 82 L18 82 Z"/>'
        '<path fill="#c9ced8" d="M72 18 L82 18 L82 82 L72 82 Z"/>'
        '<path fill="#c9ced8" d="M28 22 L37 22 L50 52 L63 22 L72 22 L72 33 L50 70 L28 33 Z"/>'
        '<path fill="#c9ced8" d="M10 12 L36 12 L36 18 L10 18 Z"/>'
        '<path fill="#c9ced8" d="M64 12 L90 12 L90 18 L64 18 Z"/>'
        '<path fill="#c9ced8" d="M10 82 L36 82 L36 88 L10 88 Z"/>'
        '<path fill="#c9ced8" d="M64 82 L90 82 L90 88 L64 88 Z"/></svg>',
    ),
    # 세 토막 점선 — 모노그램 사이를 잇는 회청색 가는 줄(가로세로 비 20, normalize 한도).
    (
        "dash",
        "three short gray dashes in a row",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#8f98ac" d="M0 47.5 L26 47.5 L26 52.5 L0 52.5 Z '
        'M37 47.5 L63 47.5 L63 52.5 L37 52.5 Z M74 47.5 L100 47.5 L100 52.5 L74 52.5 Z"/></svg>',
    ),
    # 세리프 이니셜 R — 굵은 기둥과 가는 다리의 아이보리 R(마름모 도트 템플릿의 로고 자리 표시).
    (
        "initialr",
        "ivory elegant serif initial letter r logo",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#efe6d2" d="M31 14 H40 V86 H31 Z M22 11 H46 V15 H22 Z M22 85 H49 V89 H22 Z"/>'
        '<path fill="#efe6d2" d="M40 11 H58 C76 11 83 21 83 31 C83 42 74 52 58 52'
        ' H40 V48 H57 C69 48 74 41 74 31 C74 22 69 15 57 15 H40 Z"/>'
        '<path fill="#efe6d2" d="M53 49 H58 L84 86 H79 Z M71 85 H91 V89 H71 Z"/></svg>',
    ),
    # 마름모 도트 — 아이보리 테두리 마름모 안에 진한 빨강 마름모(안쪽 경로는 역방향으로 구멍).
    (
        "rhombdot",
        "ivory diamond dot with dark red center",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">'
        '<path fill="#ece0c6" d="M12 0 L24 12 L12 24 L0 12 Z M12 5 L5 12 L12 19 L19 12 Z"/>'
        '<path fill="#8a1f2c" d="M12 7 L17 12 L12 17 L7 12 Z"/></svg>',
    ),
    # 아이보리 세리프 V 이니셜 — 왼쪽 획은 굵고 오른쪽 획은 가는 로마자 V.
    (
        "initialv",
        "ivory serif capital letter V initial mark",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#ece2cf" d="M14 12 H44 V17 H38 L54 70 L71 17 H64 V12 H86 V17 H79 L54 88 H49'
        ' L25 17 H14 Z"/></svg>',
    ),
    # 크로슬릿 — 팔 끝이 세 잎인 아이보리 십자(윈도페인 체크 템플릿의 로고 자리 표시).
    (
        "crosslet",
        "ivory ornate cross with trefoil arm ends",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><g fill="#efe3c4">'
        '<path d="M45 16 H55 V45 H84 V55 H55 V84 H45 V55 H16 V45 H45Z"/>'
        '<circle cx="50" cy="9" r="7"/><circle cx="41" cy="17" r="6"/>'
        '<circle cx="59" cy="17" r="6"/><circle cx="50" cy="91" r="7"/>'
        '<circle cx="41" cy="83" r="6"/><circle cx="59" cy="83" r="6"/>'
        '<circle cx="9" cy="50" r="7"/><circle cx="17" cy="41" r="6"/>'
        '<circle cx="17" cy="59" r="6"/><circle cx="91" cy="50" r="7"/>'
        '<circle cx="83" cy="41" r="6"/><circle cx="83" cy="59" r="6"/>'
        '<path d="M50 38 L62 50 L50 62 L38 50Z"/></g></svg>',
    ),
    # 한 파장 폭의 차콜 물결 두 줄 — 격자로 이어 붙이면 연속 가로 물결선(물결선 템플릿).
    (
        "undulation",
        "charcoal tone-on-tone double wave line segment",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
        '<path fill="#34373c" d="M0 8.5C8.36 4.04 15.99 0 25 0C34.01 0 41.64 4.04 50 8.5'
        "C58.36 12.96 65.99 17 75 17C84.01 17 91.64 12.96 100 8.5L100 16.5"
        "C91.64 20.96 84.01 25 75 25C65.99 25 58.36 20.96 50 16.5"
        "C41.64 12.04 34.01 8 25 8C15.99 8 8.36 12.04 0 16.5Z"
        "M0 83.5C8.36 79.04 15.99 75 25 75C34.01 75 41.64 79.04 50 83.5"
        "C58.36 87.96 65.99 92 75 92C84.01 92 91.64 87.96 100 83.5L100 91.5"
        "C91.64 95.96 84.01 100 75 100C65.99 100 58.36 95.96 50 91.5"
        'C41.64 87.04 34.01 83 25 83C15.99 83 8.36 87.04 0 91.5Z"/></svg>',
    ),
]


# 출처: https://github.com/freepik-company/flaticon-uicons (Flaticon license) —
# uicons-regular-rounded 웹폰트 글리프를 SVG path로 추출해 커밋한 것.
_ASSET_DIR = pathlib.Path(__file__).parent / "motif_assets"


def _tags_for(subject: str, *extra: str) -> list[str]:
    """subject + 파일명 토큰 + 한글 동의어 + 카테고리 — 순서 보존 중복 제거."""
    return list(dict.fromkeys([subject, *extra, *VOCAB_BY_SUBJECT.get(subject, [])]))


def _all_seeds() -> list[tuple[str, str, str, list[str], str]]:
    """(subject, style, description, tags, raw_svg) — 인라인 데모 + 에셋 글리프.

    에셋 subject = 파일명 첫 토큰 — `cat-head`·`cat-space`가 검색에서 `cat`으로 잡힌다.
    """
    seeds = [(subject, "flat", desc, _tags_for(subject), svg) for subject, desc, svg in _SEEDS]
    seeds += [
        (
            subject := path.stem.split("-")[0],
            "outline",
            f"{path.stem.replace('-', ' ')} outline icon",
            _tags_for(subject, path.stem, *path.stem.split("-")),
            path.read_text(),
        )
        for path in sorted(_ASSET_DIR.glob("*.svg"))
    ]
    return seeds


async def seed_motifs() -> tuple[int, int, int]:
    settings = get_settings()
    engine = build_engine(settings)
    sessionmaker = async_sessionmaker(engine, expire_on_commit=False)
    inserted = 0
    retagged = 0
    seeded_ids: list[str] = []
    async with sessionmaker() as session:
        for subject, style, description, tags, svg in _all_seeds():
            normalized = normalize_motif_svg(svg, id_prefix="seed", render_check=False)
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
                status="approved",
            )
            # upsert는 ON CONFLICT DO NOTHING이라 기존 행 tags를 갱신하지 않는다.
            # 한글·카테고리 tag 백필을 위해 시드 행 tags는 의도값으로 명시 재기록한다(멱등).
            # 실제로 값이 바뀐 행만 임베딩을 무효화한다 — embedding_document가 tags를 포함하므로
            # 태그를 고치면 grounding 벡터가 낡는다. NULL은 index_motif_embeddings.py가 채운다.
            result = cast(
                CursorResult,
                await session.execute(
                    update(Motif)
                    .where(Motif.id == normalized.id, Motif.tags.is_distinct_from(tags))
                    .values(tags=tags, embedding_openai=None)
                ),
            )
            retagged += result.rowcount
            seeded_ids.append(normalized.id)
            inserted += 1
        pruned = await store.prune_stale_seeds(session, seeded_ids)
        await session.commit()
    await engine.dispose()
    return inserted, retagged, pruned


if __name__ == "__main__":
    count, retagged, pruned = asyncio.run(seed_motifs())
    print(f"seeded {count} motifs, retagged {retagged}, pruned {pruned} stale (idempotent)")
    # 재기록된 행은 임베딩이 지워졌다 — 다시 인덱싱하지 않으면 grounding 벡터가 빈다.
    if retagged:
        print("→ run: uv run python apps/worker/scripts/index_motif_embeddings.py --confirm-live")

"""결정론 장치 — 안정 해시·변형 선택 (worker-engine.md §5).

내장 hash() 금지. 같은 (intent, seed, colorway, registry_version)
→ byte-identical SVG를 위한 안정 해시·layout_id·variant 선택을 여기서 고정한다.
"""

import hashlib
import json
from typing import TYPE_CHECKING

ENGINE_VERSION = "0.1.0"
REGISTRY_VERSION = "0.1.0"

if TYPE_CHECKING:
    from worker.engine.intent import Intent


def layout_id_for(intent: "Intent") -> str:
    """배치 구성의 안정 id — seed/colorways/palette 제외(같은 레이아웃이면 동일)."""
    payload = intent.model_dump(
        mode="json", exclude={"seed", "colorways", "palette"}, exclude_none=True
    )
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()[:12]


def stable_hash(text: str) -> int:
    """sha256 전체 digest를 int로 — 프로세스·플랫폼 불변, 절대 truncate하지 않음."""
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest(), 16)


def select_variant(pool_ids: list[str], variant_group: str, seed: int) -> str:
    """(variant_group, seed)의 순수 함수로 풀에서 하나 선택 — 풀은 id 정렬."""
    if not pool_ids:
        raise ValueError("select_variant requires a non-empty pool")
    pool = sorted(pool_ids)
    return pool[stable_hash(f"{variant_group}:{seed}") % len(pool)]

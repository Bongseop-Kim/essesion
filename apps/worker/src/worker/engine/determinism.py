"""결정론 장치 — 안정 정렬·시드 RNG·해시·repro 메타 (worker-engine.md §5).

내장 hash()·전역 random 금지. 같은 (intent, seed, colorway, registry_version)
→ byte-identical SVG의 움직이는 부품(순서·난수·메타)을 여기서 고정한다.
"""

import hashlib
import json
import random
from dataclasses import dataclass
from typing import TYPE_CHECKING

ENGINE_VERSION = "0.1.0"
REGISTRY_VERSION = "0.1.0"

if TYPE_CHECKING:
    from worker.engine.intent import Intent


def layer_sort_key(layer) -> tuple[int, str]:
    return (layer.z_order, layer.id)


def sorted_layers(layers):
    return sorted(layers, key=layer_sort_key)


def seeded_rng(seed: int) -> random.Random:
    return random.Random(seed)


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


@dataclass(frozen=True, kw_only=True)
class ReproMeta:
    intent_version: int
    seed: int
    colorway_id: str
    engine_version: str = ENGINE_VERSION
    registry_version: str = REGISTRY_VERSION
    layout_id: str | None = None

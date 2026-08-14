"""모티프 정의와 카탈로그 조회 (worker-motifs.md §1).

프로덕션 소스는 DB(motifs, pgvector) — 요청 초입에서 store.get_motifs로 조회한
`MotifCatalog`(불변 Mapping)를 엔진에 명시 인자로 전달한다(ARCHITECTURE §6
프로세스-로컬 상태 금지). 아래 전역 `_REGISTRY`는 catalog 미전달 시의 폴백으로,
골든/단위 테스트 전용이다.
"""

from collections.abc import Mapping
from dataclasses import dataclass

BBox = tuple[float, float, float, float]
Anchor = tuple[float, float]


@dataclass(frozen=True)
class MotifDef:
    id: str
    symbol: str  # <symbol id="motif-{id}" overflow="visible">…</symbol> (구체 색 보존)
    bbox_mm: BBox = (-0.5, -0.5, 0.5, 0.5)
    anchor: Anchor = (0.0, 0.0)


_REGISTRY: dict[str, MotifDef] = {}


def register_motif(motif: MotifDef) -> str:
    _REGISTRY[motif.id] = motif
    return motif.id


def get_motif(motif_id: str) -> MotifDef:
    try:
        return _REGISTRY[motif_id]
    except KeyError:
        raise ValueError(f"unknown motif: {motif_id!r}") from None


MotifCatalog = Mapping[str, MotifDef]


def resolve_motif(motif_id: str, motifs: MotifCatalog | None) -> MotifDef:
    """catalog 우선 조회 — None이면 전역 registry 폴백(테스트 경로)."""
    if motifs is None:
        return get_motif(motif_id)
    try:
        return motifs[motif_id]
    except KeyError:
        raise ValueError(f"unknown motif: {motif_id!r}") from None


def iter_motif_ids(raw: object) -> set[str]:
    """raw intent dict에서 모티프 레이어의 motif_id 수집 — validate 전 스캔.

    layout 변이는 모티프를 추가하지 않으므로 이 집합이 요청 전체의 카탈로그 범위다.
    구조가 어긋난 항목은 조용히 건너뛴다(구조 검증은 validate_intent 소관).
    """
    ids: set[str] = set()
    if not isinstance(raw, dict):
        return ids
    layers = raw.get("layers")
    if not isinstance(layers, list):
        return ids
    for layer in layers:
        if not isinstance(layer, dict) or layer.get("type") != "motif":
            continue
        params = layer.get("params")
        motif_id = params.get("motif_id") if isinstance(params, dict) else None
        if isinstance(motif_id, str) and motif_id:
            ids.add(motif_id)
    return ids

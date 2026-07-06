"""모티프 레지스트리 — in-memory 정의 저장 + 슬롯 심볼 파생 (worker-motifs.md §1).

모티프 소스는 궁극적으로 DB(motifs, pgvector) — 정규화·해시·store 연동은 후속.
지금은 등록/조회 계약과 compose가 쓰는 slot_render_symbols만 제공한다(테스트는
골든 motifs.json을 등록해 사용).
"""

from dataclasses import dataclass

BBox = tuple[float, float, float, float]
Anchor = tuple[float, float]


@dataclass(frozen=True)
class MotifDef:
    id: str
    symbol: str  # <symbol id="motif-{id}" overflow="visible">…</symbol> (슬롯 토큰 보존)
    bbox_mm: BBox = (-0.5, -0.5, 0.5, 0.5)
    anchor: Anchor = (0.0, 0.0)
    color_slots: tuple[str, ...] = ("s0",)


_REGISTRY: dict[str, MotifDef] = {}


def register_motif(motif: MotifDef) -> str:
    _REGISTRY[motif.id] = motif
    return motif.id


def get_motif(motif_id: str) -> MotifDef:
    try:
        return _REGISTRY[motif_id]
    except KeyError:
        raise ValueError(f"unknown motif: {motif_id!r}") from None


def clear_registry() -> None:
    """테스트 전용 — 프로세스 상태 격리."""
    _REGISTRY.clear()


def slot_render_symbols(motif: MotifDef) -> list[tuple[str, str]]:
    """슬롯별 colorway-agnostic 심볼 파생 (worker-engine.md §6).

    단색은 원본 심볼 그대로(motif-{id}). 멀티컬러는 슬롯 k마다 활성 토큰만
    currentColor, 나머지는 none — `fill="sK"` 정확일치 치환(닫는 따옴표 포함,
    s1/s10 충돌 방지). color_slots 순서 = z-order.
    """
    if len(motif.color_slots) <= 1:
        return [(f"motif-{motif.id}", motif.symbol)]
    out: list[tuple[str, str]] = []
    for k in range(len(motif.color_slots)):
        body = motif.symbol
        for j, slot in enumerate(motif.color_slots):
            repl = "currentColor" if j == k else "none"
            body = body.replace(f'fill="{slot}"', f'fill="{repl}"')
            body = body.replace(f'stroke="{slot}"', f'stroke="{repl}"')
        sym_id = f"motif-{motif.id}-s{k}"
        body = body.replace(f'id="motif-{motif.id}"', f'id="{sym_id}"', 1)
        out.append((sym_id, body))
    return out

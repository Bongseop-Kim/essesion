"""재사용 모티프 풀에서 registry_version 파생 (worker-motifs.md §8).

"(prompt, seed, registry_version) → 같은 결과" 봉인은 풀이 바뀌면 버전도 움직일 때만
성립한다. 풀은 가변 DB 상태이므로 정적 상수로는 추적 불가 — 요청 시점에 정렬된 모티프
id를 지문화해 stamp와 풀이 원자적으로 함께 움직이게 한다.

프로세스-로컬 memo는 두지 않는다(ARCHITECTURE §7): 요청당 한 번 경량 id 스캔.
"""

from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from worker.engine.determinism import REGISTRY_VERSION, stable_hash
from worker.motifs import store


async def registry_version_for(session: AsyncSession) -> str:
    """REGISTRY_VERSION + 재사용 풀 지문. 풀이 비면 baseline 그대로.

    비지 않으면 f"{REGISTRY_VERSION}+pool.{hex8}", hex8 = sha256("\\n".join(sorted ids))[:8].
    풀 내용의 순수 함수(시간·난수·저장 순서 무관 — id를 재정렬).
    """
    pool_ids = sorted(await store.all_motif_ids(session))
    if not pool_ids:
        return REGISTRY_VERSION
    hex8 = format(stable_hash("\n".join(pool_ids)), "064x")[:8]
    return f"{REGISTRY_VERSION}+pool.{hex8}"

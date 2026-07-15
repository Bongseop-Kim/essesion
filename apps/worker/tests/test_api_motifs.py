"""/motifs/* + /generate 모티프 경로 API 테스트 — 실컨테이너 + respx (worker-motifs.md §3~§6)."""

import json
from types import SimpleNamespace

import httpx
import respx
from worker.adapters.gemini import GeminiClient
from worker.api import routes
from worker.motifs import store
from worker.motifs.normalize import normalize_motif_svg

_CIRCLE = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">'
    '<circle cx="50" cy="50" r="30" fill="#ff0000"/></svg>'
)


async def _seed_dot(session) -> str:
    motif = normalize_motif_svg(_CIRCLE, render_check=False)
    mid = await store.upsert_motif(
        session, motif, facets={"subject": "dot", "scope": "whole"}, source="seed"
    )
    await session.commit()
    return mid


async def test_motifs_candidates_returns_seeded(client, db_session):
    await _seed_dot(db_session)
    resp = await client.post(
        "/motifs/candidates", json={"spec": {"subject": "dot", "scope": "whole"}, "top_k": 5}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["registry_version"]
    assert body["candidates"]
    assert body["candidates"][0]["scope"] == "whole"


async def test_motifs_generate_503_when_unconfigured_and_miss(client):
    # 빈 DB → miss → Recraft 미구성 → 503.
    resp = await client.post(
        "/motifs/generate", json={"spec": {"subject": "novel", "scope": "whole"}}
    )
    assert resp.status_code == 503


async def test_motifs_generate_reuses_seeded(client, db_session):
    mid = await _seed_dot(db_session)
    resp = await client.post(
        "/motifs/generate", json={"spec": {"subject": "dot", "scope": "whole"}}
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["motif_id"] == mid
    assert body["reused"] is True
    assert body["similarity"] == 1.0


def _lattice_intent(motif_id: str) -> dict:
    return {
        "intent_version": 1,
        "canvas": {"tile_mm": 48, "dpi": 300},
        "seed": 0,
        "production": {"method": "print", "max_colors": 12},
        "palette": {
            "slots": [{"id": "ground", "hex": "#10243a"}, {"id": "accent", "hex": "#ef8a7a"}]
        },
        "colorways": [
            {
                "id": "default",
                "name": "default",
                "mapping": {"ground": "#10243a", "accent": "#ef8a7a"},
            }
        ],
        "layers": [
            {"id": "ground", "type": "background", "z_order": 0, "params": {"color": "ground"}},
            {
                "id": "m0",
                "type": "motif",
                "z_order": 1,
                "params": {"motif_id": motif_id, "size_mm": 6.0, "color": "accent"},
                "placement": {"type": "lattice", "lattice": {"cell_w_mm": 12.0, "cell_h_mm": 12.0}},
            },
        ],
    }


async def test_generate_renders_with_db_motif_catalog(client, db_session):
    mid = await _seed_dot(db_session)
    resp = await client.post(
        "/generate", json={"intent": _lattice_intent(mid), "candidate_count": 1}
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["candidates"]
    assert body["registry_version"].startswith("0.1.0")


@respx.mock
async def test_prompt_path_end_to_end_with_gemini(app, client, db_session):
    mid = await _seed_dot(db_session)
    app.state.adapters.gemini = GeminiClient("test-key")  # DryRun 대신 목 클라이언트 주입
    design = {
        "designs": [
            {
                "intent": _lattice_intent("m0"),  # placeholder — resolver가 치환
                "motif_specs": [{"layer_id": "m0", "subject": "dot", "scope": "whole"}],
            }
        ]
    }
    respx.post(url__regex=r".*generateContent").mock(
        return_value=httpx.Response(
            200, json={"candidates": [{"content": {"parts": [{"text": json.dumps(design)}]}}]}
        )
    )
    resp = await client.post("/generate", json={"prompt": "polka dots", "candidate_count": 1})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["candidates"]
    assert len(body["intents"]) == 1
    # 시드 모티프로 재사용 해석됐는지 — 로그 intent의 motif_id가 치환됐는지 확인
    assert mid in body["candidates"][0]["svg"]
    assert body["intents"][0]["layers"][1]["params"]["motif_id"] == mid


async def test_prompt_motif_resolution_uses_authored_seed_without_override(
    app, client, db_session, monkeypatch
):
    mid = await _seed_dot(db_session)
    intent = _lattice_intent(mid)
    intent["seed"] = 37

    class FakeGemini:
        async def author_designs(self, _prompt, *, validate):
            assert validate(intent) is None
            return [SimpleNamespace(intent=intent, motif_specs=[])]

    seen: list[int] = []

    async def capture_seed(_session, raw, _specs, **kwargs):
        seen.append(kwargs["seed"])
        return raw

    app.state.adapters.gemini = FakeGemini()
    monkeypatch.setattr(routes, "resolve_motifs", capture_seed)

    response = await client.post("/generate", json={"prompt": "seeded dots", "candidate_count": 1})

    assert response.status_code == 200, response.text
    assert seen == [37]
    assert response.json()["candidates"][0]["seed"] == 37

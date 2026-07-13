from api.main import create_app
from httpx import ASGITransport, AsyncClient


async def test_healthz_with_db_backed_app(client: AsyncClient):
    res = await client.get("/healthz")
    assert res.status_code == 200
    assert "x-request-id" in res.headers


async def test_nonlocal_readyz_checks_database(settings):
    application = create_app(
        settings.model_copy(
            update={
                "env": "staging",
                "public_api_origin": "https://api.essesion.shop",
                "edge_proxy_secret": "edge-test-secret",
            }
        )
    )

    async with application.router.lifespan_context(application):
        async with AsyncClient(
            transport=ASGITransport(app=application),
            base_url="https://test",
        ) as client:
            direct = await client.get("/readyz")
            response = await client.get(
                "/readyz", headers={"X-Essesion-Edge-Secret": "edge-test-secret"}
            )

    assert direct.status_code == 403
    assert response.json()["capabilities"]["database"] == "ready"

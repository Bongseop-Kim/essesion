from httpx import AsyncClient


async def test_healthz_with_db_backed_app(client: AsyncClient):
    res = await client.get("/healthz")
    assert res.status_code == 200
    assert "x-request-id" in res.headers

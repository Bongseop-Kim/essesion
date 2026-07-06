"""OpenAPI 계약 퍼징(schemathesis) — 전 엔드포인트 5xx 부재 검증.

기존 testcontainers 픽스처(app)를 그대로 재사용한다. 인증은 admin Bearer로
(인가 실패 4xx는 계약 위반이 아님 — not_a_server_error만 검사).
"""

import pytest
import schemathesis
from hypothesis import HealthCheck
from hypothesis import settings as hypothesis_settings
from schemathesis.checks import not_a_server_error

from .factories import auth_headers, make_admin

_auth_headers: dict[str, str] = {}

schema = schemathesis.pytest.from_fixture("api_schema")


@pytest.fixture
async def api_schema(app, db_session, settings):
    from api.integrations.toss import DryRunTossClient

    admin = await make_admin(db_session)
    _auth_headers.clear()
    _auth_headers.update(auth_headers(admin, settings))
    # 퍼징이 /payments/webhook 등에서 실제 Toss로 나가지 않도록 DryRun으로 교체
    app.state.toss = DryRunTossClient()
    return schemathesis.openapi.from_asgi("/openapi.json", app)


@schema.parametrize()
@hypothesis_settings(
    max_examples=3,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)
def test_api_contract(case):
    case.call_and_validate(headers=_auth_headers, checks=(not_a_server_error,))

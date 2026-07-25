"""OpenAPI 계약 퍼징(schemathesis) — 전 엔드포인트 5xx 부재 검증.

커밋된 openapi.json에서 스키마를 로드해 오퍼레이션당 pytest 테스트 1개로 펼친다.
from_fixture 방식은 전 오퍼레이션이 subtests 1개 테스트로 묶여 xdist가 쪼갤 수 없었다.
스펙 드리프트는 codegen-drift 잡이 막는다.
"""

from pathlib import Path
from typing import Any

import pytest
import schemathesis
from hypothesis import HealthCheck
from hypothesis import settings as hypothesis_settings
from schemathesis.checks import not_a_server_error

from .factories import auth_headers, make_admin

OPENAPI_JSON = Path(__file__).parents[3] / "packages/api-client/openapi.json"
schema = schemathesis.openapi.from_path(OPENAPI_JSON)

# 픽스처가 채우는 호출 컨텍스트 — schemathesis 테스트 함수는 픽스처를 인자로 못 받는다.
_ctx: dict[str, Any] = {}


@pytest.fixture
async def contract_app(app, db_session, settings):
    from api.integrations.toss import DryRunTossClient

    admin = await make_admin(db_session)
    # Schemathesis의 ASGI transport가 lifespan을 다시 열어 클라이언트를 재구성하므로
    # 현재 state뿐 아니라 lifespan closure가 참조하는 설정도 DryRun으로 고정한다.
    settings.toss_secret_key = ""
    app.state.toss = DryRunTossClient()
    _ctx.update(app=app, headers=auth_headers(admin, settings))
    yield
    _ctx.clear()


@schema.parametrize()
@hypothesis_settings(
    max_examples=3,
    deadline=None,
    suppress_health_check=[HealthCheck.function_scoped_fixture, HealthCheck.too_slow],
)
def test_api_contract(case, contract_app):
    case.call_and_validate(
        app=_ctx["app"],
        base_url="http://testserver",
        headers=_ctx["headers"],
        checks=(not_a_server_error,),
    )

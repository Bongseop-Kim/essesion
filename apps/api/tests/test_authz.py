"""인가 3규칙 매트릭스 실행기 — 케이스 등록은 authz.py."""

import pytest

from .authz import ADMIN_CASES, OWNER_CASES, AdminCase, OwnerCase
from .factories import auth_headers, make_admin, make_user


@pytest.mark.parametrize("case", OWNER_CASES, ids=lambda c: c.name)
async def test_owner_only_resource(case: OwnerCase, client, db_session, settings):
    owner = await make_user(db_session, name="소유자")
    other = await make_user(db_session, name="타인")
    admin = await make_admin(db_session)
    url, body = await case.make(db_session, owner)

    anonymous = await client.request(case.method, url, json=body)
    assert anonymous.status_code == 401, f"{case.name}: 익명은 401이어야 함"

    forbidden = await client.request(
        case.method, url, json=body, headers=auth_headers(other, settings)
    )
    assert forbidden.status_code == 403, f"{case.name}: 타인은 403이어야 함"

    owned = await client.request(case.method, url, json=body, headers=auth_headers(owner, settings))
    assert owned.status_code not in (401, 403), f"{case.name}: 소유자는 인가 통과해야 함"

    as_admin = await client.request(
        case.method, url, json=body, headers=auth_headers(admin, settings)
    )
    assert as_admin.status_code == 401, f"{case.name}: admin 세션은 store 경로와 분리돼야 함"


@pytest.mark.parametrize("case", ADMIN_CASES, ids=lambda c: c.name)
async def test_admin_only_endpoint(case: AdminCase, client, db_session, settings):
    customer = await make_user(db_session)

    anonymous = await client.request(case.method, case.url, json=case.body)
    assert anonymous.status_code == 401, f"{case.name}: 익명은 401이어야 함"

    forbidden = await client.request(
        case.method, case.url, json=case.body, headers=auth_headers(customer, settings)
    )
    assert forbidden.status_code == 403, f"{case.name}: customer는 403이어야 함"
    assert forbidden.json()["detail"] == "관리자 권한이 없습니다."

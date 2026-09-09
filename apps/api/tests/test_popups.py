"""팝업 공지 — 공개 조회(활성 1건·KST 기간)·템플릿 필드 검증·배너 이미지 연결."""

import uuid
from datetime import UTC, datetime, timedelta

from api.domains.admin.helpers import KST
from db.models.images import Image
from sqlalchemy import select

from .factories import auth_headers, make_admin
from .fakes import simulate_uploads


def _today():
    return datetime.now(KST).date()


def _iso(d) -> str:
    return d.isoformat()


def holiday_fields(today=None, **overrides) -> dict:
    today = today or _today()
    fields = {
        "template": "holiday",
        "cutoff_on": _iso(today - timedelta(days=1)),
        "cutoff_time": "14:00",
        "closed_from": _iso(today),
        "closed_to": _iso(today + timedelta(days=3)),
        "resume_on": _iso(today + timedelta(days=4)),
        "footnote": "수선 일정도 같은 기간 멈춥니다.",
    }
    fields.update(overrides)
    return fields


def popup_body(**overrides) -> dict:
    today = _today()
    body = {
        "title": "추석 연휴",
        "title_emphasis": "배송 안내",
        "body": "연휴 기간 **택배사 휴무**로 출고가 멈춥니다.",
        "fields": holiday_fields(today),
        "starts_on": _iso(today - timedelta(days=7)),
        "ends_on": _iso(today + timedelta(days=3)),
    }
    body.update(overrides)
    return body


async def create_popup(client, headers, **overrides) -> dict:
    response = await client.post("/admin/popups", json=popup_body(**overrides), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


async def enable(client, headers, popup_id: str) -> dict:
    response = await client.patch(
        f"/admin/popups/{popup_id}", json={"enabled": True}, headers=headers
    )
    assert response.status_code == 200, response.text
    return response.json()


async def issue_popup_image(app, client, headers, *, complete: bool = True) -> dict:
    issued = await client.post(
        "/admin/popups/images/upload-url",
        json={"filename": "banner.png", "content_type": "image/png", "size_bytes": 100},
        headers=headers,
    )
    assert issued.status_code == 200, issued.text
    assert issued.json()["required_headers"]["x-goog-if-generation-match"] == "0"
    if not complete:
        return issued.json()
    await simulate_uploads(app)
    completed = await client.post(
        f"/admin/popups/images/{issued.json()['upload_id']}/complete", headers=headers
    )
    assert completed.status_code == 200, completed.text
    return completed.json()


async def test_public_active_returns_one_enabled_popup_in_period(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    today = _today()

    # 등록 직후는 비활성이라 공개 조회에 나오지 않는다.
    created = await create_popup(client, headers)
    assert created["enabled"] is False and created["active_now"] is False
    assert (await client.get("/popups/active")).json() is None

    await enable(client, headers, created["id"])
    active = (await client.get("/popups/active")).json()
    assert active["id"] == created["id"]
    assert active["template"] == "holiday"
    assert active["fields"]["cutoff_time"] == "14:00"
    # store 렌더에 필요한 것만 — 노출 기간·활성 여부는 공개 응답에 없다.
    assert "starts_on" not in active and "enabled" not in active

    # 활성이어도 기간 밖이면 숨는다 (경계: ends_on = 어제).
    yesterday = _iso(today - timedelta(days=1))
    expired = await client.patch(
        f"/admin/popups/{created['id']}", json={"ends_on": yesterday}, headers=headers
    )
    assert expired.status_code == 200, expired.text
    assert expired.json()["active_now"] is False
    assert (await client.get("/popups/active")).json() is None

    # 경계 포함: starts_on = ends_on = 오늘.
    boundary = await client.patch(
        f"/admin/popups/{created['id']}",
        json={"starts_on": _iso(today), "ends_on": _iso(today)},
        headers=headers,
    )
    assert boundary.json()["active_now"] is True
    assert (await client.get("/popups/active")).json()["id"] == created["id"]


async def test_public_active_picks_latest_start_when_overlapping(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    today = _today()
    older = await create_popup(client, headers, starts_on=_iso(today - timedelta(days=10)))
    newer = await create_popup(client, headers, starts_on=_iso(today - timedelta(days=2)))
    await enable(client, headers, older["id"])
    await enable(client, headers, newer["id"])

    assert (await client.get("/popups/active")).json()["id"] == newer["id"]

    listed = (await client.get("/admin/popups", headers=headers)).json()
    assert {row["id"] for row in listed} == {older["id"], newer["id"]}
    assert all(row["active_now"] for row in listed)


async def test_field_validation_rejects_bad_order_and_shapes(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    today = _today()

    # 휴무 종료가 재개일보다 뒤 — 달력이 깨진다.
    broken = holiday_fields(today, resume_on=_iso(today + timedelta(days=1)))
    response = await client.post("/admin/popups", json=popup_body(fields=broken), headers=headers)
    assert response.status_code == 422, response.text

    # 종료일 < 시작일.
    response = await client.post(
        "/admin/popups",
        json=popup_body(starts_on=_iso(today), ends_on=_iso(today - timedelta(days=1))),
        headers=headers,
    )
    assert response.status_code == 422

    # 운영 안내 표는 4행까지.
    rows = [{"label": f"항목{i}", "value": "값"} for i in range(5)]
    response = await client.post(
        "/admin/popups",
        json=popup_body(fields={"template": "operation", "rows": rows}),
        headers=headers,
    )
    assert response.status_code == 422

    # 이벤트는 링크 필수.
    response = await client.post(
        "/admin/popups",
        json=popup_body(
            fields={"template": "event", "image_upload_id": str(uuid.uuid4())}, link_url=None
        ),
        headers=headers,
    )
    assert response.status_code == 422

    # 링크는 내부 경로 또는 https만.
    response = await client.post(
        "/admin/popups", json=popup_body(link_url="javascript:alert(1)"), headers=headers
    )
    assert response.status_code == 422

    # PATCH로 기간을 뒤집는 것도 막는다 (병합 뒤 검증).
    created = await create_popup(client, headers)
    response = await client.patch(
        f"/admin/popups/{created['id']}",
        json={"ends_on": _iso(today - timedelta(days=30))},
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_popup_period"


async def test_event_image_links_replaces_and_expires(app, client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)

    first = await issue_popup_image(app, client, headers)
    assert first["public_url"].endswith(".png") and "/popups/" in first["public_url"]

    created = await create_popup(
        client,
        headers,
        title="추석 선물 준비",
        title_emphasis=None,
        fields={"template": "event", "image_upload_id": first["upload_id"]},
        link_url="/shop",
    )
    assert created["template"] == "event"
    assert created["fields"]["image_url"] == first["public_url"]
    assert created["fields"]["image_upload_id"] == first["upload_id"]

    linked = await db_session.get(Image, uuid.UUID(first["upload_id"]))
    await db_session.refresh(linked)
    assert (linked.entity_type, linked.entity_id, linked.expires_at) == (
        "popup",
        created["id"],
        None,
    )

    # 공개 응답은 URL만 — upload id를 노출하지 않는다.
    await enable(client, headers, created["id"])
    active = (await client.get("/popups/active")).json()
    assert active["fields"] == {"template": "event", "image_url": first["public_url"]}

    # 교체하면 이전 이미지는 만료된다.
    second = await issue_popup_image(app, client, headers)
    replaced = await client.patch(
        f"/admin/popups/{created['id']}",
        json={"fields": {"template": "event", "image_upload_id": second["upload_id"]}},
        headers=headers,
    )
    assert replaced.status_code == 200, replaced.text
    assert replaced.json()["fields"]["image_url"] == second["public_url"]
    await db_session.refresh(linked)
    assert linked.expires_at is not None and linked.expires_at <= datetime.now(UTC)

    # 템플릿을 바꾸면 배너도 만료된다.
    switched = await client.patch(
        f"/admin/popups/{created['id']}",
        json={"fields": holiday_fields()},
        headers=headers,
    )
    assert switched.status_code == 200, switched.text
    second_row = await db_session.get(Image, uuid.UUID(second["upload_id"]))
    await db_session.refresh(second_row)
    assert second_row.expires_at is not None

    # 삭제 뒤 404.
    assert (
        await client.delete(f"/admin/popups/{created['id']}", headers=headers)
    ).status_code == 204
    gone = await client.patch(
        f"/admin/popups/{created['id']}", json={"enabled": False}, headers=headers
    )
    assert gone.status_code == 404


async def test_event_image_rejects_unfinished_and_foreign_uploads(
    app, client, db_session, settings
):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)

    unfinished = await issue_popup_image(app, client, headers, complete=False)
    response = await client.post(
        "/admin/popups",
        json=popup_body(
            fields={"template": "event", "image_upload_id": unfinished["upload_id"]},
            link_url="/shop",
        ),
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["code"] == "popup_image_not_completed"

    other_admin = await make_admin(db_session, email="other-admin@example.com")
    other_headers = auth_headers(other_admin, settings)
    foreign = await issue_popup_image(app, client, other_headers)
    response = await client.post(
        "/admin/popups",
        json=popup_body(
            fields={"template": "event", "image_upload_id": foreign["upload_id"]},
            link_url="/shop",
        ),
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["code"] == "invalid_popup_image"

    # 상품 이미지 스테이징 행은 팝업에 붙일 수 없다 — entity_type이 다르다.
    product_issued = await client.post(
        "/admin/products/images/upload-url",
        json={"kind": "primary", "filename": "p.png", "content_type": "image/png", "size_bytes": 5},
        headers=headers,
    )
    assert product_issued.status_code == 200
    response = await client.post(
        "/admin/popups",
        json=popup_body(
            fields={"template": "event", "image_upload_id": product_issued.json()["upload_id"]},
            link_url="/shop",
        ),
        headers=headers,
    )
    assert response.status_code == 422

    # 스테이징 이미지 삭제는 만료만 찍고 정리 배치에 맡긴다.
    staged = await issue_popup_image(app, client, headers, complete=False)
    deleted = await client.delete(f"/admin/popups/images/{staged['upload_id']}", headers=headers)
    assert deleted.status_code == 204
    row = await db_session.scalar(select(Image).where(Image.id == uuid.UUID(staged["upload_id"])))
    assert row is not None and row.expires_at is not None

"""첫 진입 예시 갤러리 — 공개 조회·무과금 세션 시작·admin 큐레이션."""

import uuid

from db.models.design import DesignExample, DesignSessionTurn
from db.models.seamless import Motif, SeamlessGenerationLog
from sqlalchemy import func, select

from .factories import auth_headers, make_admin, make_user

_SVG = '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'


def _intent(motif_id: str | None = None) -> dict[str, object]:
    layers: list[dict[str, object]] = [
        {"id": "bg", "type": "background", "z_order": 0, "params": {"color": "ground"}}
    ]
    if motif_id is not None:
        layers.append({"id": "m0", "type": "motif", "z_order": 1, "params": {"motif_id": motif_id}})
    return {
        "canvas": {"tile_mm": 24},
        "palette": {"slots": []},
        "colorways": [],
        "layers": layers,
    }


async def _make_run(
    db_session,
    *,
    motif_id: str | None = None,
    status: str = "success",
    panel_logo: str | None = None,
) -> uuid.UUID:
    intent = _intent(motif_id)
    if panel_logo is not None:
        intent["panel"] = [
            {"type": "motif", "motif_id": panel_logo, "at": [890, 980], "size": 140, "role": "logo"}
        ]
    log = SeamlessGenerationLog(
        input_type="intent",
        registry_version="0.1.0",
        engine_version="0.1.0",
        intent={"design": intent, "resolved_plan": {"colors": ["#10243A"], "layers": []}},
        design={
            "id": "design-1",
            "layout_id": "layout-1",
            "source_fidelity": "vector",
            "colorway_id": "default",
            "seed": 7,
            "svg": _SVG,
            "png_object_key": None,
            "panel_svg": _SVG if panel_logo is not None else None,
            "intent": intent,
        },
        status=status,
    )
    db_session.add(log)
    await db_session.commit()
    return log.id


async def _make_example(
    db_session,
    run_id,
    *,
    name="미드나잇 웨이브",
    caption="네이비 · 대각 스트라이프",
    ordinal=0,
    published=True,
    **template,
):
    example = DesignExample(
        run_id=run_id,
        name=name,
        caption=caption,
        ordinal=ordinal,
        published=published,
        **template,
    )
    db_session.add(example)
    await db_session.commit()
    await db_session.refresh(example)
    return example


async def _seed_motif(db_session, motif_id: str, source: str) -> None:
    db_session.add(
        Motif(
            id=motif_id,
            symbol=(
                f'<symbol id="motif-{motif_id}" viewBox="-0.5 -0.5 1 1">'
                '<circle cx="0" cy="0" r="0.4" fill="#123456"/></symbol>'
            ),
            bbox=[-0.5, -0.5, 0.5, 0.5],
            anchor=[0, 0],
            source=source,
        )
    )
    await db_session.commit()


async def test_public_gallery_lists_published_examples_only(client, db_session):
    published = await _make_example(
        db_session, await _make_run(db_session), name="미드나잇 웨이브", ordinal=1
    )
    await _make_example(
        db_session, await _make_run(db_session), name="숨은 초안", ordinal=0, published=False
    )

    # 비로그인도 볼 수 있어야 첫 진입이 빈 캔버스가 아니다.
    listed = await client.get("/design/examples")

    assert listed.status_code == 200
    assert [item["id"] for item in listed.json()] == [str(published.id)]
    assert listed.json()[0] == {
        "id": str(published.id),
        "name": "미드나잇 웨이브",
        "caption": "네이비 · 대각 스트라이프",
        "preview_svg": _SVG,
        "panel_svg": None,
        "logo_in_panel": False,
        "category": None,
        "point": "none",
        "logo_slots": [{"slot": 1, "label": None}],
        "photo_full_url": None,
        "photo_detail_url": None,
        "logo_preview_svg": None,
        "colorways": [],
    }


async def test_public_gallery_exposes_template_data_and_logo_slot_preview(client, db_session):
    """템플릿 데이터(시드가 쓴 값)와 로고 슬롯 모티프 미리보기 — 슬롯이 비면 null."""
    await _seed_motif(db_session, "seed-bee", "seed")
    with_logo = await _make_example(
        db_session,
        await _make_run(db_session, motif_id="seed-bee"),
        name="포인트",
        ordinal=0,
        category="격자",
        point="bottom",
        logo_slots=[{"slot": 1, "label": "로고"}, {"slot": 2, "label": "작은 무늬"}],
        photo_full_url="/templates/a/full.jpg",
    )
    empty_slot = await _make_example(
        db_session, await _make_run(db_session), name="올패턴", ordinal=1, logo_slots=[{"slot": 2}]
    )

    listed = (await client.get("/design/examples")).json()

    assert [item["id"] for item in listed] == [str(with_logo.id), str(empty_slot.id)]
    first, second = listed
    assert (first["category"], first["point"]) == ("격자", "bottom")
    assert first["logo_slots"] == [
        {"slot": 1, "label": "로고"},
        {"slot": 2, "label": "작은 무늬"},
    ]
    assert (first["photo_full_url"], first["photo_detail_url"]) == ("/templates/a/full.jpg", None)
    assert (
        first["logo_preview_svg"].startswith("<svg ")
        and "motif-seed-bee" in first["logo_preview_svg"]
    )
    assert second["logo_preview_svg"] is None


async def test_start_from_example_restores_design(client, db_session, settings):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    example = await _make_example(db_session, await _make_run(db_session))

    started = await client.post(
        "/design/sessions/from-example",
        json={"example_id": str(example.id)},
        headers=headers,
    )

    assert started.status_code == 201, started.text
    body = started.json()
    assert body["current_intent"] == _intent()
    assert (body["seed"], body["colorway"], body["registry_version"]) == (7, "default", "0.1.0")
    # 색·로고 페이지가 포인트 위치·로고 슬롯을 템플릿에서 읽는 키.
    assert body["example_id"] == str(example.id)
    fetched = await client.get(f"/design/sessions/{body['id']}", headers=headers)
    assert fetched.json()["example_id"] == str(example.id)

    # 편집 포인터(activate 턴)가 예시 run을 가리켜야 색·로고 화면이 그 SVG를 그린다.
    assert fetched.json()["preview_svg"] == _SVG
    turns = list(
        await db_session.scalars(
            select(DesignSessionTurn)
            .where(DesignSessionTurn.session_id == uuid.UUID(body["id"]))
            .order_by(DesignSessionTurn.seq)
        )
    )
    assert [(turn.role, turn.payload["type"]) for turn in turns] == [
        ("assistant", "generate"),
        ("user", "activate"),
    ]
    assert turns[0].payload["summary"] == "미드나잇 웨이브"


async def test_start_from_example_rejects_unpublished_missing_and_anonymous(
    client, db_session, settings
):
    user = await make_user(db_session)
    headers = auth_headers(user, settings)
    unpublished = await _make_example(db_session, await _make_run(db_session), published=False)

    hidden = await client.post(
        "/design/sessions/from-example",
        json={"example_id": str(unpublished.id)},
        headers=headers,
    )
    missing = await client.post(
        "/design/sessions/from-example",
        json={"example_id": str(uuid.uuid4())},
        headers=headers,
    )
    anonymous = await client.post(
        "/design/sessions/from-example", json={"example_id": str(unpublished.id)}
    )

    assert (hidden.status_code, missing.status_code, anonymous.status_code) == (404, 404, 401)
    assert await db_session.scalar(select(func.count()).select_from(DesignSessionTurn)) == 0


async def test_admin_curates_and_deletes_examples(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    run_id = await _make_run(db_session)
    example = await _make_example(db_session, run_id, published=False)
    example_id = str(example.id)

    # 템플릿은 시드 코드로만 만든다 — admin 등록 API는 없다.
    created = await client.post(
        "/admin/design/examples", json={"run_id": str(run_id), "name": "x"}, headers=headers
    )
    assert created.status_code == 405

    published = await client.patch(
        f"/admin/design/examples/{example_id}",
        json={"published": True, "ordinal": 1, "caption": "네이비 · 대각 스트라이프"},
        headers=headers,
    )
    assert published.status_code == 200
    assert (published.json()["published"], published.json()["ordinal"]) == (True, 1)
    assert len((await client.get("/design/examples")).json()) == 1

    listed = await client.get("/admin/design/examples", headers=headers)
    assert [item["run_id"] for item in listed.json()] == [str(run_id)]

    # 생략(null)은 "안 바꿈", 빈 문자열이 설명 지우기.
    kept = await client.patch(
        f"/admin/design/examples/{example_id}", json={"name": "미드나잇"}, headers=headers
    )
    cleared = await client.patch(
        f"/admin/design/examples/{example_id}", json={"caption": "  "}, headers=headers
    )
    assert kept.json()["caption"] == "네이비 · 대각 스트라이프"
    assert cleared.json()["caption"] is None

    customer = await client.delete(
        f"/admin/design/examples/{example_id}",
        headers=auth_headers(await make_user(db_session), settings),
    )
    assert customer.status_code == 403
    removed = await client.delete(f"/admin/design/examples/{example_id}", headers=headers)
    assert removed.status_code == 204
    assert (await client.get("/design/examples")).json() == []


async def test_admin_publish_rejects_over_cap(client, db_session, settings, monkeypatch):
    monkeypatch.setattr("api.domains.design.examples.MAX_PUBLISHED_EXAMPLES", 1)
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    live = await _make_example(db_session, await _make_run(db_session), name="게시 중")
    draft = await _make_example(
        db_session, await _make_run(db_session), name="대기", published=False
    )

    over_cap = await client.patch(
        f"/admin/design/examples/{draft.id}", json={"published": True}, headers=headers
    )
    assert over_cap.status_code == 409
    assert over_cap.json()["code"] == "published_example_limit"

    # 이미 게시된 예시의 수정과 게시 내리기는 상한과 무관하다.
    keep = await client.patch(
        f"/admin/design/examples/{live.id}", json={"published": True, "ordinal": 5}, headers=headers
    )
    down = await client.patch(
        f"/admin/design/examples/{live.id}", json={"published": False}, headers=headers
    )
    assert (keep.status_code, down.status_code) == (200, 200)

    # 자리가 나면 게시할 수 있다.
    freed = await client.patch(
        f"/admin/design/examples/{draft.id}", json={"published": True}, headers=headers
    )
    assert freed.status_code == 200


async def test_public_gallery_exposes_panel_svg_and_panel_logo(client, db_session):
    """배치형 템플릿 — panel SVG와 panel 로고 미리보기, 반복형은 null·False."""
    await _seed_motif(db_session, "seed-bee", "seed")
    await _seed_motif(db_session, "seed-crest", "seed")
    placed = await _make_example(
        db_session,
        await _make_run(db_session, motif_id="seed-bee", panel_logo="seed-crest"),
        name="대각 분할",
        ordinal=0,
        point="bottom",
        logo_slots=[{"slot": "logo", "label": "포인트 로고"}],
    )
    repeated = await _make_example(db_session, await _make_run(db_session), name="반복", ordinal=1)

    first, second = (await client.get("/design/examples")).json()

    assert (first["id"], second["id"]) == (str(placed.id), str(repeated.id))
    assert first["panel_svg"] == _SVG and first["logo_in_panel"] is True
    # 첫 로고 자리가 panel 로고면 그 모티프를 미리보기로 쓴다.
    assert "motif-seed-crest" in first["logo_preview_svg"]
    assert (second["panel_svg"], second["logo_in_panel"]) == (None, False)

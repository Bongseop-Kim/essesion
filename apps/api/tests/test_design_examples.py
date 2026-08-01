"""첫 진입 예시 갤러리 — 공개 조회·무과금 세션 시작·admin 큐레이션."""

import uuid

from db.models.design import DesignExample, DesignSessionTurn
from db.models.seamless import Motif, SeamlessGenerationLog
from db.models.tokens import DesignToken
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
    db_session, *, motif_id: str | None = None, status: str = "success"
) -> uuid.UUID:
    intent = _intent(motif_id)
    log = SeamlessGenerationLog(
        input_type="prompt",
        prompt="네이비 도트",
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
):
    example = DesignExample(
        run_id=run_id, name=name, caption=caption, ordinal=ordinal, published=published
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
                '<circle cx="0" cy="0" r="0.4" fill="currentColor"/></symbol>'
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
    }


async def test_start_from_example_restores_design_without_charging(client, db_session, settings):
    user = await make_user(db_session)
    db_session.add(DesignToken(user_id=user.id, amount=30, type="grant", token_class="free"))
    await db_session.commit()
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
    assert body["current_plan"] == {"colors": ["#10243A"], "layers": []}
    assert (body["seed"], body["colorway"], body["registry_version"]) == (7, "default", "0.1.0")

    # 캔버스·이력·되돌리기가 프론트 변경 없이 동작하려면 턴 2개가 그대로 있어야 한다.
    turns = (await client.get(f"/design/sessions/{body['id']}/turns", headers=headers)).json()
    assert [(turn["role"], turn["payload"]["type"]) for turn in turns] == [
        ("assistant", "generate"),
        ("user", "activate"),
    ]
    assert turns[0]["payload"]["summary"] == "미드나잇 웨이브"
    assert turns[0]["payload"]["response"]["design"]["svg"] == _SVG

    # 렌더도 워커 호출도 없다 — 원장에 차감 행이 생기지 않는다.
    assert await db_session.scalar(select(func.sum(DesignToken.amount))) == 30
    assert await db_session.scalar(select(func.count()).select_from(DesignToken)) == 1


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


async def test_admin_registers_curates_and_deletes_examples(client, db_session, settings):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    await _seed_motif(db_session, "seed-bee", "catalog")
    run_id = await _make_run(db_session, motif_id="seed-bee")

    created = await client.post(
        "/admin/design/examples",
        json={
            "run_id": str(run_id),
            "name": "미드나잇 웨이브",
            "caption": "네이비 · 대각 스트라이프",
            "ordinal": 3,
        },
        headers=headers,
    )
    assert created.status_code == 201, created.text
    assert created.json()["published"] is False
    assert created.json()["caption"] == "네이비 · 대각 스트라이프"
    assert created.json()["preview_svg"] == _SVG
    example_id = created.json()["id"]

    # 같은 run을 두 번 등록할 수 없다(unique run_id).
    duplicate = await client.post(
        "/admin/design/examples",
        json={"run_id": str(run_id), "name": "중복"},
        headers=headers,
    )
    assert duplicate.status_code == 409

    published = await client.patch(
        f"/admin/design/examples/{example_id}",
        json={"published": True, "ordinal": 1},
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

    removed = await client.delete(f"/admin/design/examples/{example_id}", headers=headers)
    assert removed.status_code == 204
    assert (await client.get("/design/examples")).json() == []


async def test_admin_registration_rejects_private_motifs_unknown_runs_and_non_admins(
    client, db_session, settings
):
    admin = await make_admin(db_session)
    headers = auth_headers(admin, settings)
    await _seed_motif(db_session, "upload-333333333333", "user_upload")
    private_run = await _make_run(db_session, motif_id="upload-333333333333")

    private = await client.post(
        "/admin/design/examples",
        json={"run_id": str(private_run), "name": "비공개 모티프"},
        headers=headers,
    )
    unknown = await client.post(
        "/admin/design/examples",
        json={"run_id": str(uuid.uuid4()), "name": "없는 런"},
        headers=headers,
    )
    customer = await client.post(
        "/admin/design/examples",
        json={"run_id": str(private_run), "name": "고객 등록"},
        headers=auth_headers(await make_user(db_session), settings),
    )

    assert private.status_code == 409
    assert private.json()["code"] == "private_motif_example"
    assert unknown.status_code == 409
    assert unknown.json()["code"] == "design_result_unavailable"
    assert customer.status_code == 403
    assert await db_session.scalar(select(func.count()).select_from(DesignExample)) == 0

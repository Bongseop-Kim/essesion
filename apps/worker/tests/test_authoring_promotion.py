"""생성 결과 기반 저작 예시 승격 후보 선별."""

from datetime import UTC, datetime, timedelta

from db.models.auth import User
from db.models.design import DesignSession, DesignSessionTurn, GenerationJob
from db.models.seamless import AuthoringPromotionCandidate, SeamlessGenerationLog
from sqlalchemy import select
from worker.authoring.compiler import COMPILER_REVISION, PLAN_CONTRACT_VERSION
from worker.authoring.examples import load_example_set
from worker.authoring.promotion import scan_promotion_candidates

DIM = 3072
MODEL = "test-embedding-3072"


class _Embedding:
    model = MODEL

    async def embed(self, text: str, *, task_type: str = "RETRIEVAL_QUERY") -> list[float]:
        assert text.strip()
        assert task_type == "RETRIEVAL_DOCUMENT"
        return [1.0] + [0.0] * (DIM - 1)


async def _source(
    db_session,
    *,
    prompt: str,
    plan_index: int = 0,
    finalized: bool = True,
    finalize_selected: bool = True,
    regenerate_before_finalize: bool = False,
    status: str = "success",
) -> SeamlessGenerationLog:
    user = User(name="승격 테스트 사용자", role="customer")
    db_session.add(user)
    await db_session.flush()
    design_session = DesignSession(user_id=user.id, status="active")
    db_session.add(design_session)
    await db_session.flush()
    example = load_example_set()[plan_index]
    candidate_id = f"candidate-{plan_index}-{design_session.id.hex[:8]}"
    log = SeamlessGenerationLog(
        input_type="prompt",
        prompt=prompt,
        intent={
            "authoring": {
                "plan_contract_version": PLAN_CONTRACT_VERSION,
                "compiler_revision": COMPILER_REVISION,
                "prompt_revision": "design-plan-v3-rag-grounded",
                "plans": [example.plan.model_dump(mode="json")],
            }
        },
        candidates=[
            {
                "id": candidate_id,
                "design_index": 0,
                "svg": '<svg xmlns="http://www.w3.org/2000/svg"/>',
            }
        ],
        status=status,
    )
    db_session.add(log)
    await db_session.flush()
    base = datetime.now(UTC) - timedelta(minutes=5)
    turns = [
        DesignSessionTurn(
            session_id=design_session.id,
            seq=1,
            role="assistant",
            payload={
                "type": "generate",
                "response": {"generation_log_id": str(log.id)},
            },
            created_at=base,
        ),
        DesignSessionTurn(
            session_id=design_session.id,
            seq=2,
            role="user",
            payload={"type": "select", "candidate_id": candidate_id},
            created_at=base + timedelta(seconds=1),
        ),
    ]
    if regenerate_before_finalize:
        turns.append(
            DesignSessionTurn(
                session_id=design_session.id,
                seq=3,
                role="user",
                payload={"type": "generate_request"},
                created_at=base + timedelta(seconds=2),
            )
        )
    db_session.add_all(turns)
    if finalized:
        db_session.add(
            GenerationJob(
                user_id=user.id,
                session_id=design_session.id,
                kind="finalize",
                status="succeeded",
                params={"candidate_id": candidate_id if finalize_selected else "another-candidate"},
                created_at=base + timedelta(seconds=3),
                updated_at=base + timedelta(seconds=3),
            )
        )
    await db_session.commit()
    await db_session.refresh(log)
    return log


async def test_scan_registers_only_selected_successful_finalize(db_session):
    eligible = await _source(
        db_session,
        prompt="차분한 네이비 단색 패턴",
    )
    await _source(
        db_session,
        prompt="실사화하지 않은 패턴",
        plan_index=1,
        finalized=False,
    )
    await _source(
        db_session,
        prompt="다른 후보만 실사화한 패턴",
        plan_index=1,
        finalize_selected=False,
    )
    await _source(
        db_session,
        prompt="재생성 뒤 실사화한 패턴",
        plan_index=2,
        regenerate_before_finalize=True,
    )
    await _source(
        db_session,
        prompt="부분 성공 패턴",
        plan_index=3,
        status="partial",
    )

    result = await scan_promotion_candidates(
        db_session,
        embedding_client=_Embedding(),
    )

    assert result.scanned == 1
    assert result.pending == 1
    assert result.duplicate == 0
    candidate = await db_session.scalar(select(AuthoringPromotionCandidate))
    assert candidate is not None
    assert candidate.source_generation_log_id == eligible.id
    assert candidate.retrieval_text == "차분한 네이비 단색 패턴"
    assert candidate.status == "pending"
    assert candidate.embedding_model == MODEL
    assert candidate.rule_reasons == ["success", "selected", "finalized"]
    assert "svg" not in candidate.plan

    repeated = await scan_promotion_candidates(
        db_session,
        embedding_client=_Embedding(),
    )
    assert repeated.scanned == 0
    assert repeated.pending == 0


async def test_scan_deduplicates_earlier_candidate_in_same_batch(db_session):
    await _source(db_session, prompt="첫 번째 같은 구조")
    await _source(db_session, prompt="두 번째 같은 구조")

    result = await scan_promotion_candidates(
        db_session,
        embedding_client=_Embedding(),
    )

    assert result.scanned == 2
    assert result.pending == 1
    assert result.duplicate == 1
    rows = list(
        await db_session.scalars(
            select(AuthoringPromotionCandidate).order_by(
                AuthoringPromotionCandidate.created_at,
                AuthoringPromotionCandidate.id,
            )
        )
    )
    assert {row.status for row in rows} == {"pending", "duplicate"}
    duplicate = next(row for row in rows if row.status == "duplicate")
    assert duplicate.nearest_kind == "candidate"
    assert duplicate.nearest_similarity == 1.0

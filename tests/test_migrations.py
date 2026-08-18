from alembic import command
from db.testing import alembic_config, migrated_postgres


def test_upgrade_head_applies_and_matches_models():
    # 리비전 id를 나열하지 않는다 — 마이그레이션마다 깨지기만 하고, 분기·다중 head는
    # alembic이 `head` 해석 단계에서 이미 CommandError로 막는다. 여기서 볼 건 정주행·역주행이
    # 실제 Postgres에 적용되고 최종 스키마가 모델과 일치하는지다.
    with migrated_postgres() as url:
        config = alembic_config(url)
        command.downgrade(config, "base")
        command.upgrade(config, "head")
        command.check(config)

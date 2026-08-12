from alembic import command
from alembic.script import ScriptDirectory
from db.testing import alembic_config, migrated_postgres


def test_upgrade_head_applies_and_matches_models():
    with migrated_postgres() as url:
        config = alembic_config(url)
        revisions = list(ScriptDirectory.from_config(config).walk_revisions())
        assert [revision.revision for revision in revisions] == [
            "a4d9c1e57b02",
            "e71baf2532ce",
            "6dbb8bb66939",
            "f8c3b2a19d47",
        ]

        command.downgrade(config, "base")
        command.upgrade(config, "head")
        command.check(config)

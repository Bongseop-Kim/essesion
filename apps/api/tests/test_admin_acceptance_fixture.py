import json
import re
from pathlib import Path

ROOT = Path(__file__).parents[3]
FIXTURE = ROOT / "docs" / "fixtures" / "admin-route-acceptance.json"
ROUTER = ROOT / "apps" / "admin" / "src" / "app" / "router" / "router.tsx"


def _path_only(path: str) -> str:
    return path.split("?", maxsplit=1)[0]


def test_reference_inventory_is_complete_and_actionable() -> None:
    contract = json.loads(FIXTURE.read_text())
    routes = contract["routes"]

    assert len(routes) == 25
    assert len({route["reference_route"] for route in routes}) == 25
    assert all(route["display_fields"] for route in routes)
    assert all(route["actions"] for route in routes)


def test_canonical_acceptance_routes_are_declared_by_admin_router() -> None:
    contract = json.loads(FIXTURE.read_text())
    source = ROUTER.read_text()
    declared = {"/"}
    for match in re.finditer(r'path:\s*"([^"]+)"', source):
        path = match.group(1)
        declared.add(path if path.startswith("/") else f"/{path}")

    required = {
        _path_only(route["canonical_route"])
        for route in [*contract["routes"], *contract["new_operational_routes"]]
    }
    assert required <= declared

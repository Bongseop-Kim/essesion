"""OpenAPI 스펙 추출 → packages/api-client/openapi.json (커밋 대상).

결정론 보장: operationId = 라우트 함수명(main._operation_id), sort_keys 직렬화.
Settings는 시크릿 없이 기본값으로 동작하므로 DB·외부 연동 없이 실행 가능.

실행: uv run python apps/api/scripts/export_openapi.py
"""

import json
from pathlib import Path

from api.main import create_app

OUTPUT = Path(__file__).parents[3] / "packages" / "api-client" / "openapi.json"


def main() -> None:
    spec = create_app().openapi()
    OUTPUT.write_text(
        json.dumps(spec, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"{OUTPUT}: {len(spec['paths'])} paths")


if __name__ == "__main__":
    main()

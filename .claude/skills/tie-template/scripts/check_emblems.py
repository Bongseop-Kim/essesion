"""템플릿별 포인트 로고(엠블럼) 모티프 subject 표 — logo_slot이 로고를 가리키는지 눈으로 확인한다.

usage (레포 루트, api :8000·DB 기동 상태):
  uv run python .claude/skills/tie-template/scripts/check_emblems.py
"""

import json
import re
import subprocess
import urllib.request

examples = json.load(urllib.request.urlopen("http://localhost:8000/design/examples"))
for example in examples:
    match = re.search(r'id="motif-([^"]+)"', example.get("logo_preview_svg") or "")
    subject = "-"
    if match:
        subject = subprocess.run(
            [
                "docker",
                "compose",
                "exec",
                "-T",
                "db",
                "psql",
                "-U",
                "essesion",
                "-d",
                "essesion",
                "-At",
                "-c",
                f"select subject from motifs where id = '{match[1]}'",
            ],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
    print(f"{example['point']:6} slot={example['logo_slot']} {subject:12} {example['name']}")

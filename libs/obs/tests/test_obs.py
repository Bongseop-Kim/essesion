"""obs.sanitize_request_id — GCS object key에 인바운드 request_id가 경로 주입되지 않게."""

import re

from obs import sanitize_request_id

UUID_HEX = re.compile(r"[0-9a-f]{32}")


def test_strips_path_injection():
    out = sanitize_request_id("../../etc/passwd")
    assert "/" not in out
    assert ".." not in out
    assert out == "etc-passwd"


def test_allowed_chars_pass_through():
    assert sanitize_request_id("abc_DEF-123") == "abc_DEF-123"


def test_length_capped():
    assert len(sanitize_request_id("a" * 500)) == 128


def test_empty_result_gets_fresh_uuid():
    # 전부 무효 문자거나 빈 입력이면 새 uuid4 hex를 발급한다.
    assert UUID_HEX.fullmatch(sanitize_request_id("///"))
    assert UUID_HEX.fullmatch(sanitize_request_id(""))

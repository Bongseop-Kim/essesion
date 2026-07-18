"""로컬 스토리지 정적 서빙·직접 업로드 라우트 — LocalGcsClient 짝꿍 (로컬 개발 전용).

GCS의 서명 URL 흐름을 재현한다: GET은 공개 서빙(<img src>), PUT은 브라우저
직접 업로드(putToSignedUrl). 서명·인가가 없으므로 build 시점에 로컬 스토리지
모드일 때만 마운트되며, OpenAPI 스키마에서도 제외된다(codegen 불변).
"""

import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import FileResponse
from starlette.concurrency import run_in_threadpool

from api.integrations.gcs import (
    LOCAL_STORAGE_PREFIX,
    local_object_content_type,
    local_object_path,
    local_storage_root,
    write_local_object,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix=LOCAL_STORAGE_PREFIX, include_in_schema=False)

# 개별 업로드가 max_size 쿼리를 안 들고 와도 무한정 받지 않는 로컬 상한
_MAX_PUT_BYTES = 32 * 1024 * 1024


def _resolve_path(request: Request, bucket: str, object_key: str) -> Path:
    settings = request.app.state.settings
    try:
        return local_object_path(local_storage_root(settings), bucket, object_key)
    except ValueError:
        raise HTTPException(status_code=404) from None


@router.get("/{bucket}/{object_key:path}")
async def get_local_object(bucket: str, object_key: str, request: Request) -> FileResponse:
    path = _resolve_path(request, bucket, object_key)
    if not path.is_file():
        raise HTTPException(status_code=404)
    media_type = await run_in_threadpool(local_object_content_type, path, object_key)
    return FileResponse(path, media_type=media_type)


@router.put("/{bucket}/{object_key:path}")
async def put_local_object(bucket: str, object_key: str, request: Request) -> Response:
    path = _resolve_path(request, bucket, object_key)
    body = await request.body()
    try:
        max_size = int(request.query_params.get("max_size", _MAX_PUT_BYTES))
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid max_size") from None
    if not body or len(body) > min(max_size, _MAX_PUT_BYTES):
        # GCS x-goog-content-length-range 위반에 대응
        raise HTTPException(status_code=413, detail="payload size out of range")
    if request.query_params.get("create_only"):
        exists = await run_in_threadpool(path.is_file)
        if exists:
            # GCS x-goog-if-generation-match: 0 위반에 대응 — staging 키는 불변
            raise HTTPException(status_code=412, detail="object already exists")
    content_type = request.headers.get("content-type")
    await run_in_threadpool(write_local_object, path, body, content_type)
    logger.info("local storage put: %s/%s (%d bytes)", bucket, object_key, len(body))
    return Response(status_code=200)

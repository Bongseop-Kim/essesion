# api·worker 공용 — 빌드 컨텍스트는 레포 루트, APP=api|worker
# ponytail: 단일 스테이지. api도 librsvg를 들지만 Dockerfile 분기보다 싸다.
# 반대쪽 앱의 소스는 복사하지 않는다 — api 이미지에 worker 렌더·모티프 에셋 32MB가
# 실리던 낭비 제거(perf 플랜 20번). 미설치 워크스페이스 멤버는 pyproject만 있으면
# uv가 해석하므로 pyproject를 먼저 깔고 대상 앱만 통째로 덮는다.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
ARG APP=api
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends librsvg2-bin \
    && rm -rf /var/lib/apt/lists/*
COPY pyproject.toml uv.lock ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/worker/pyproject.toml apps/worker/pyproject.toml
COPY libs libs
COPY db db
COPY apps/${APP} apps/${APP}
RUN uv sync --frozen --no-dev --package essesion-${APP}
ENV PATH="/app/.venv/bin:$PATH" APP_MODULE=${APP}.main:app
CMD exec uvicorn ${APP_MODULE} --host 0.0.0.0 --port ${PORT:-8080}

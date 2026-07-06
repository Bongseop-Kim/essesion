# api·worker 공용 — 빌드 컨텍스트는 레포 루트, APP=api|worker
# ponytail: 단일 스테이지. api도 librsvg를 들지만 Dockerfile 분기보다 싸다.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
ARG APP=api
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1
RUN apt-get update \
    && apt-get install -y --no-install-recommends librsvg2-bin \
    && rm -rf /var/lib/apt/lists/*
COPY . .
RUN uv sync --frozen --no-dev --package essesion-${APP}
ENV PATH="/app/.venv/bin:$PATH" APP_MODULE=${APP}.main:app
CMD exec uvicorn ${APP_MODULE} --host 0.0.0.0 --port ${PORT:-8080}

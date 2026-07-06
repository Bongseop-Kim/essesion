# api·worker 공용 — 빌드 컨텍스트는 레포 루트, APP=api|worker
# ponytail: 단일 스테이지. 워커에 폰트·resvg가 붙는 4단계에서 분리 검토.
FROM ghcr.io/astral-sh/uv:python3.13-bookworm-slim
ARG APP=api
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1
COPY . .
RUN uv sync --frozen --no-dev --package essesion-${APP}
ENV PATH="/app/.venv/bin:$PATH" APP_MODULE=${APP}.main:app
CMD exec uvicorn ${APP_MODULE} --host 0.0.0.0 --port ${PORT:-8080}

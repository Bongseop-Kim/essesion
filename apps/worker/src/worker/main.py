from fastapi import FastAPI
from obs import RequestIdMiddleware, init_observability

init_observability("worker")

app = FastAPI(title="essesion worker")
app.add_middleware(RequestIdMiddleware)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}

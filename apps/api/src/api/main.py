from fastapi import FastAPI
from obs import RequestIdMiddleware, init_observability

init_observability("api")

app = FastAPI(title="essesion api")
app.add_middleware(RequestIdMiddleware)


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}

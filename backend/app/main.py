import asyncio, json
from contextlib import asynccontextmanager
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from redis.asyncio import Redis
from .config import get_settings
from .routers import auth, devices, dashboard, wans, interfaces

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield


app = FastAPI(title="Smart City NMS", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router, prefix="/api")
app.include_router(devices.router, prefix="/api")
app.include_router(dashboard.router, prefix="/api")
app.include_router(wans.router, prefix="/api")
app.include_router(interfaces.router, prefix="/api")


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.websocket("/ws")
async def websocket(ws: WebSocket):
    await ws.accept()
    redis = Redis.from_url(settings.redis_url, decode_responses=True)
    pubsub = redis.pubsub()
    await pubsub.subscribe("nms:events")
    try:
        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=20)
            if msg and msg.get("data"):
                await ws.send_text(msg["data"])
            else:
                await ws.send_text(json.dumps({"type": "heartbeat"}))
            await asyncio.sleep(0.2)
    except WebSocketDisconnect:
        pass
    finally:
        await pubsub.unsubscribe("nms:events")
        await pubsub.close()
        await redis.close()

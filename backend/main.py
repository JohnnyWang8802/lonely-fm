import asyncio

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from routers.http import router as http_router
from routers.ws import CUE_TEXT_BY_EMOTION, router as ws_router
from services.gemma import gemma_service
from services.tts import tts_service

settings = get_settings()

app = FastAPI(title="Lonely FM API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(http_router, prefix="/api")
app.include_router(ws_router)


@app.on_event("startup")
async def prewarm_voice_cache() -> None:
    # Load the local model in the background so the first real turn skips the ~5s cold start,
    # without blocking server startup / health checks.
    asyncio.create_task(gemma_service.prewarm())
    tts_service.prewarm_cue_audio()
    tts_service.prewarm_cue_audio("这句我听懂了。")
    for cue_text in CUE_TEXT_BY_EMOTION.values():
        tts_service.prewarm_cue_audio(cue_text)
    tts_service.prewarm_common_replies()

from fastapi import APIRouter

from config import get_settings
from services.gemma import gemma_service

router = APIRouter()


@router.get("/health")
async def health() -> dict[str, object]:
    settings = get_settings()
    gemma_status = await gemma_service.status()
    gemma_available = bool(gemma_status.get("available"))
    hume_configured = bool(settings.hume_api_key)
    minimax_configured = bool(settings.minimax_api_key and settings.minimax_tts_voice_id)
    google_tts_configured = bool(settings.google_application_credentials)
    return {
        "ok": True,
        "service": "lonely-fm",
        "demo_mode": settings.demo_mode,
        "gemma_provider": settings.gemma_provider,
        "local_gemma_provider": settings.local_gemma_provider,
        "local_gemma_base_url": settings.local_gemma_base_url,
        "gemma_configured": gemma_available,
        "gemma_available": gemma_available,
        "hume_configured": hume_configured,
        "tts_provider": settings.tts_provider,
        "minimax_configured": minimax_configured,
        "google_tts_configured": google_tts_configured,
        "emotion_stack": "hume-expression" if hume_configured else "local-prosody",
        "voice_stack": "minimax" if minimax_configured else ("google-fallback" if google_tts_configured else "browser-fallback"),
        "sesame_jump_ready": minimax_configured,
        "supabase_configured": settings.supabase_configured,
    }


@router.get("/gemma/status")
async def gemma_status() -> dict[str, object]:
    return await gemma_service.status()

from __future__ import annotations

from functools import lru_cache
from os import getenv
from pathlib import Path

from dotenv import load_dotenv

ROOT_DIR = Path(__file__).resolve().parents[1]
load_dotenv(ROOT_DIR / ".env")
load_dotenv()


class Settings:
    hume_api_key: str | None = getenv("HUME_API_KEY")
    hume_stream_url: str = getenv("HUME_STREAM_URL", "wss://api.hume.ai/v0/stream/models")
    hume_timeout_seconds: float = float(getenv("HUME_TIMEOUT_SECONDS", "8"))
    gemma_provider: str = getenv("GEMMA_PROVIDER", "local")
    google_ai_api_key: str | None = getenv("GOOGLE_AI_API_KEY")
    gemma_model: str = getenv("GEMMA_MODEL", "gemma4:12b-mlx")
    local_gemma_provider: str = getenv("LOCAL_GEMMA_PROVIDER", "ollama")
    local_gemma_base_url: str = getenv("LOCAL_GEMMA_BASE_URL", "http://127.0.0.1:11434")
    local_gemma_api_key: str | None = getenv("LOCAL_GEMMA_API_KEY")
    fish_audio_api_key: str | None = getenv("FISH_AUDIO_API_KEY")
    fish_audio_voice_id: str | None = getenv("FISH_AUDIO_VOICE_ID")
    tts_provider: str = getenv("TTS_PROVIDER", "minimax")
    minimax_api_key: str | None = getenv("MINIMAX_API_KEY")
    minimax_tts_endpoint: str = getenv("MINIMAX_TTS_ENDPOINT", "https://api-uw.minimax.io/v1/t2a_v2")
    minimax_tts_ws_endpoint: str = getenv("MINIMAX_TTS_WS_ENDPOINT", "wss://api.minimax.io/ws/v1/t2a_v2")
    minimax_tts_streaming_enabled: bool = getenv("MINIMAX_TTS_STREAMING", "false").lower() == "true"
    minimax_tts_ws_open_timeout: float = float(getenv("MINIMAX_TTS_WS_OPEN_TIMEOUT", "1.2"))
    minimax_tts_ws_cooldown_seconds: float = float(getenv("MINIMAX_TTS_WS_COOLDOWN_SECONDS", "90"))
    minimax_tts_model: str = getenv("MINIMAX_TTS_MODEL", "speech-2.6-turbo")
    minimax_tts_voice_id: str = getenv("MINIMAX_TTS_VOICE_ID", "Chinese (Mandarin)_Radio_Host")
    minimax_tts_language_boost: str = getenv("MINIMAX_TTS_LANGUAGE_BOOST", "auto")
    minimax_tts_speed: float = float(getenv("MINIMAX_TTS_SPEED", "1.0"))
    minimax_tts_volume: float = float(getenv("MINIMAX_TTS_VOLUME", "1.0"))
    minimax_tts_pitch: int = int(getenv("MINIMAX_TTS_PITCH", "0"))
    minimax_tts_sample_rate: int = int(getenv("MINIMAX_TTS_SAMPLE_RATE", "24000"))
    minimax_tts_bitrate: int = int(getenv("MINIMAX_TTS_BITRATE", "64000"))
    hybrid_first_chunk_tts: bool = getenv("HYBRID_FIRST_CHUNK_TTS", "false").lower() == "true"
    google_application_credentials: str | None = getenv("GOOGLE_APPLICATION_CREDENTIALS")
    google_tts_language: str = getenv("GOOGLE_TTS_LANGUAGE", "cmn-CN")
    google_tts_voice: str = getenv("GOOGLE_TTS_VOICE", "cmn-CN-Chirp3-HD-Aoede")
    google_tts_speaking_rate: float = float(getenv("GOOGLE_TTS_SPEAKING_RATE", "0.94"))
    google_tts_pitch: float = float(getenv("GOOGLE_TTS_PITCH", "1.5"))
    openai_api_key: str | None = getenv("OPENAI_API_KEY")
    openai_stt_model: str = getenv("OPENAI_STT_MODEL", "whisper-1")
    redis_url: str = getenv("REDIS_URL", "redis://localhost:6379")
    database_url: str = getenv(
        "DATABASE_URL",
        "postgresql+asyncpg://user:password@localhost/lonelyfm",
    )
    supabase_url: str | None = getenv("SUPABASE_URL")
    supabase_anon_key: str | None = getenv("SUPABASE_ANON_KEY")
    secret_key: str = getenv("SECRET_KEY", "dev-secret")
    cors_origins: list[str] = [
        origin.strip()
        for origin in getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,https://lonely-fm.vercel.app",
        ).split(",")
        if origin.strip()
    ]
    demo_mode: bool = getenv("DEMO_MODE", "true").lower() != "false"

    @property
    def supabase_configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_anon_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()

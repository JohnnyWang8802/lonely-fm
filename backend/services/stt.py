from __future__ import annotations

import base64

import httpx

from config import get_settings


class SttService:
    async def transcribe_audio_chunk(self, audio_base64: str, mime_type: str | None = None) -> str | None:
        settings = get_settings()
        if not settings.openai_api_key:
            return None
        try:
            audio_bytes = base64.b64decode(audio_base64)
            if len(audio_bytes) < 1024:
                return None
            extension = self._extension_for_mime(mime_type)
            files = {
                "file": (f"speech.{extension}", audio_bytes, mime_type or "audio/webm"),
            }
            data = {
                "model": settings.openai_stt_model,
                # no fixed language → Whisper auto-detects (bilingual zh/en)
                "response_format": "json",
            }
            headers = {"Authorization": f"Bearer {settings.openai_api_key}"}
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post(
                    "https://api.openai.com/v1/audio/transcriptions",
                    headers=headers,
                    data=data,
                    files=files,
                )
                response.raise_for_status()
                payload = response.json()
            text = str(payload.get("text", "")).strip()
            return text or None
        except Exception as exc:
            print(f"STT fallback: {exc}")
            return None

    def _extension_for_mime(self, mime_type: str | None) -> str:
        if not mime_type:
            return "webm"
        if "mp4" in mime_type:
            return "mp4"
        if "mpeg" in mime_type or "mp3" in mime_type:
            return "mp3"
        if "wav" in mime_type:
            return "wav"
        return "webm"


stt_service = SttService()

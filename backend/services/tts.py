from __future__ import annotations

import asyncio
import base64
from collections.abc import AsyncIterator
import hashlib
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import time
from typing import Any

import httpx

from config import get_settings

COMMON_REPLY_TEXTS = (
    "我在。",
    "你好呀。",
    "我在，慢慢说。",
    "这种空我听见了。不是没事做，是心里暂时找不到一个落点。先把这股空说清楚就好。",
    "这份累我听见了。",
    "听起来你是真的累了，不只是困那种。像是一直在撑，但没人替你接一下。你先告诉我，是身上累，还是心里更累？",
    "嗯，我听见了。",
    "好，我接着听。",
    "烦劲上来了，我听见了。",
    "这股气我听到了。它不是小题大做，更像是你有个边界被碰到了。先说最刺的那一下。",
    "这份委屈挺真实的。难受的点可能不是这句话本身，是你觉得自己没有被好好看见。",
    "懂，你现在不是一件事烦，是很多事挤在一起。我们先别全拆，先抓最烦你的那个点：是人，还是项目本身？",
    "被这样一说，心里不舒服很正常。尤其是工作里被质疑，很容易让人开始怀疑自己。你先说说，他质疑的是结果，还是你的能力？",
    "一个人撑着，确实会重。",
    "这种一个人的感觉挺难受的，不只是没人说话，是好像没人真的懂你。你现在更想有人听你说，还是先安静陪一会儿？",
    "我懂，这种感觉会把人掏空。它不一定说明你真的没价值，可能是最近做的事一直没给你反馈。哪件事最让你觉得白忙了？",
    "我懂，你不是懒，可能是那件事一靠近就让你有压力。我们先别要求自己立刻解决，你说说，最不想碰的是哪一块？",
    "听起来你卡在开始前那一步了。脑子里想得越多，身体越不想动。我们先别把它做完，只挑一个最小动作，哪一步最容易先碰一下？",
    "听起来你不是不会选，是每个选项都要你放弃点什么。我们先不急着定答案，你最怕丢掉的是哪一边？",
    "这事听着挺扎心的。关系里最难受的常常不是输赢，是你在意的人没有认真接住你。你现在更想要解释，还是想被好好对待？",
    "先别这么重地判自己。可能是一件事卡住了，你就把整个人都否了。哪件事最先让你有这种感觉？",
)

PREWARM_REPLY_TEXTS = (
    "我在。",
    "你好呀。",
    "我在，慢慢说。",
    "嗯，我在。",
    "嗯，我听着。",
    "好，我接着听。",
    "我在，你说。",
    "这种空我听见了。不是没事做，是心里暂时找不到一个落点。先把这股空说清楚就好。",
    "这份累我听见了。",
    "听起来你是真的累了，不只是困那种。像是一直在撑，但没人替你接一下。你先告诉我，是身上累，还是心里更累？",
    "烦劲上来了，我听见了。",
    "这股气我听到了。它不是小题大做，更像是你有个边界被碰到了。先说最刺的那一下。",
    "这份委屈挺真实的。难受的点可能不是这句话本身，是你觉得自己没有被好好看见。",
    "一个人撑着，确实会重。",
    "这种一个人的感觉挺难受的，不只是没人说话，是好像没人真的懂你。你现在更想有人听你说，还是先安静陪一会儿？",
    "听起来你卡在开始前那一步了。脑子里想得越多，身体越不想动。我们先别把它做完，只挑一个最小动作，哪一步最容易先碰一下？",
)


class TtsService:
    def __init__(self) -> None:
        self._cue_audio_cache: dict[str, str] = {}
        self._cue_tasks: dict[str, asyncio.Task[None]] = {}
        self._reply_audio_cache: dict[str, str] = {}
        self._reply_tasks: dict[str, asyncio.Task[None]] = {}
        self._http_client: httpx.AsyncClient | None = None
        self._disk_cache_dir = Path(__file__).resolve().parents[2] / ".cache" / "tts"
        self._minimax_stream_disabled_until = 0.0
        self._minimax_stream_failure_count = 0
        self._google_disabled_until = 0.0
        self._common_prewarmed_voice_ids: set[str] = set()
        self._google_tts_client: Any | None = None
        self._google_tts_client_lock = threading.Lock()
        self._google_prewarm_started = False
        self._transport_prewarm_tasks: dict[str, asyncio.Task[None]] = {}

    def get_cached_cue_audio(self, text: str = "嗯。", voice_id: str | None = None) -> str | None:
        key = self._cue_cache_key(text, voice_id)
        cached_audio = self._cue_audio_cache.get(key)
        if cached_audio:
            return cached_audio
        cached_audio = self._read_disk_audio_cache(key)
        if cached_audio:
            self._cue_audio_cache[key] = cached_audio
        return cached_audio

    def prewarm_cue_audio(self, text: str = "嗯。", voice_id: str | None = None) -> None:
        key = self._cue_cache_key(text, voice_id)
        if self.get_cached_cue_audio(text, voice_id):
            return
        existing_task = self._cue_tasks.get(key)
        if existing_task and not existing_task.done():
            return
        self._cue_tasks[key] = asyncio.create_task(self._cache_cue_audio(key, text, voice_id))

    def get_cached_reply_audio(self, text: str, voice_id: str | None = None) -> str | None:
        key = self._reply_cache_key(text, voice_id)
        cached_audio = self._reply_audio_cache.get(key)
        if cached_audio:
            return cached_audio
        cached_audio = self._read_disk_audio_cache(key)
        if cached_audio:
            self._reply_audio_cache[key] = cached_audio
        return cached_audio

    def prewarm_common_replies(self, voice_id: str | None = None) -> None:
        effective_voice_id = self._minimax_voice_id(voice_id)
        if effective_voice_id in self._common_prewarmed_voice_ids:
            return
        self._common_prewarmed_voice_ids.add(effective_voice_id)
        for text in PREWARM_REPLY_TEXTS:
            self.prewarm_reply_audio(text, effective_voice_id)

    def prewarm_google_client(self) -> None:
        settings = get_settings()
        if self._google_prewarm_started or not settings.google_application_credentials:
            return
        self._google_prewarm_started = True
        asyncio.create_task(self._prewarm_google_client())

    def prewarm_transport(self, voice_id: str | None = None) -> None:
        """Warm the MiniMax HTTP connection without sending audio to the client."""
        settings = get_settings()
        if settings.tts_provider.lower() != "minimax" or not settings.minimax_api_key:
            return
        effective_voice_id = self._minimax_voice_id(voice_id)
        existing_task = self._transport_prewarm_tasks.get(effective_voice_id)
        if existing_task and not existing_task.done():
            return
        self._transport_prewarm_tasks[effective_voice_id] = asyncio.create_task(
            self._prewarm_transport(effective_voice_id)
        )

    async def wait_for_transport_prewarm(self, voice_id: str | None = None, timeout: float = 5.0) -> None:
        settings = get_settings()
        if settings.tts_provider.lower() != "minimax" or not settings.minimax_api_key:
            return
        effective_voice_id = self._minimax_voice_id(voice_id)
        task = self._transport_prewarm_tasks.get(effective_voice_id)
        if not task:
            self.prewarm_transport(effective_voice_id)
            task = self._transport_prewarm_tasks.get(effective_voice_id)
        if not task:
            return
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=timeout)
        except asyncio.TimeoutError:
            return

    def prewarm_reply_audio(self, text: str, voice_id: str | None = None) -> None:
        key = self._reply_cache_key(text, voice_id)
        if self.get_cached_reply_audio(text, voice_id):
            return
        existing_task = self._reply_tasks.get(key)
        if existing_task and not existing_task.done():
            return
        self._reply_tasks[key] = asyncio.create_task(self._cache_reply_audio(key, text, voice_id))

    async def _cache_cue_audio(self, key: str, text: str, voice_id: str | None = None) -> None:
        try:
            audio = await self.synthesize(text, {"primary": "calm"}, voice_id)
            if audio:
                self._cue_audio_cache[key] = audio
                self._write_disk_audio_cache(key, audio)
        except Exception as exc:
            print(f"TTS cue prewarm failed: {exc}")
        finally:
            self._cue_tasks.pop(key, None)

    async def _cache_reply_audio(self, key: str, text: str, voice_id: str | None = None) -> None:
        try:
            audio = await self._synthesize_with_minimax(text, {"primary": "calm"}, voice_id)
            if audio:
                self._reply_audio_cache[key] = audio
                self._write_disk_audio_cache(key, audio)
        except Exception as exc:
            print(f"TTS reply prewarm failed: {exc}")
        finally:
            self._reply_tasks.pop(key, None)

    async def _prewarm_google_client(self) -> None:
        try:
            await asyncio.to_thread(self._get_google_tts_client)
        except Exception as exc:
            print(f"Google TTS client prewarm failed: {exc}")

    async def _prewarm_transport(self, voice_id: str) -> None:
        try:
            await self._synthesize_with_minimax("好。", {"primary": "calm"}, voice_id)
        except Exception as exc:
            print(f"TTS transport prewarm failed: {exc}")
        finally:
            self._transport_prewarm_tasks.pop(voice_id, None)

    def _cue_cache_key(self, text: str, voice_id: str | None = None) -> str:
        return self._audio_cache_key(text, "cue", voice_id)

    def _reply_cache_key(self, text: str, voice_id: str | None = None) -> str:
        return self._audio_cache_key(text, "reply-single-voice-v3", voice_id)

    def _audio_cache_key(self, text: str, namespace: str, voice_id: str | None = None) -> str:
        settings = get_settings()
        effective_voice_id = self._minimax_voice_id(voice_id)
        return "|".join(
            [
                namespace,
                settings.tts_provider,
                settings.minimax_tts_model,
                effective_voice_id,
                str(settings.minimax_tts_speed),
                str(settings.minimax_tts_pitch),
                str(settings.minimax_tts_sample_rate),
                str(settings.minimax_tts_bitrate),
                text,
            ]
        )

    def _client(self) -> httpx.AsyncClient:
        if self._http_client is None or self._http_client.is_closed:
            # Default keepalive_expiry is 5s — too short, so each turn re-pays the ~2.3s TLS
            # handshake to the MiniMax endpoint. Hold connections open far longer.
            self._http_client = httpx.AsyncClient(
                timeout=httpx.Timeout(18, connect=6),
                limits=httpx.Limits(max_keepalive_connections=8, keepalive_expiry=120),
            )
        return self._http_client

    async def synthesize(
        self,
        text: str,
        emotion: dict[str, Any] | None = None,
        voice_id: str | None = None,
    ) -> str | None:
        settings = get_settings()
        provider = settings.tts_provider.lower()
        if provider == "minimax":
            audio = await self._synthesize_with_minimax(text, emotion, voice_id)
            if audio:
                return audio
            audio = await self._synthesize_with_google(text, emotion)
            if audio:
                return audio
            audio = await self._synthesize_with_fish(text)
            if audio:
                return audio
            return await self._synthesize_with_macos(text, emotion, voice_id)
        if provider == "google":
            audio = await self._synthesize_with_google(text, emotion)
            if audio:
                return audio
        if provider == "fish":
            return await self._synthesize_with_fish(text)
        try:
            return await self._synthesize_with_fish(text)
        except Exception:
            return None

    async def synthesize_stream(
        self,
        text: str,
        emotion: dict[str, Any] | None = None,
        low_latency: bool = False,
        voice_id: str | None = None,
    ) -> AsyncIterator[str]:
        settings = get_settings()
        provider = settings.tts_provider.lower()
        if provider == "minimax":
            cached_audio = self.get_cached_reply_audio(text, voice_id)
            if cached_audio:
                yield cached_audio
                return
            if low_latency and settings.hybrid_first_chunk_tts and not (
                settings.minimax_api_key and settings.minimax_tts_voice_id
            ):
                audio = await self._synthesize_with_google(text, emotion)
                if audio:
                    key = self._reply_cache_key(text, voice_id)
                    self._reply_audio_cache[key] = audio
                    self._write_disk_audio_cache(key, audio)
                    yield audio
                    return
            if settings.minimax_tts_streaming_enabled and self._can_try_minimax_stream():
                streamed_parts: list[str] = []
                async for audio in self._synthesize_with_minimax_stream(text, emotion, voice_id):
                    streamed_parts.append(audio)
                    yield audio
                if streamed_parts:
                    self._minimax_stream_failure_count = 0
                    key = self._reply_cache_key(text, voice_id)
                    joined_audio = self._join_audio_parts(streamed_parts)
                    self._reply_audio_cache[key] = joined_audio
                    self._write_disk_audio_cache(key, joined_audio)
                    return
            audio = await self._synthesize_with_minimax(text, emotion, voice_id)
            if audio:
                key = self._reply_cache_key(text, voice_id)
                self._reply_audio_cache[key] = audio
                self._write_disk_audio_cache(key, audio)
                yield audio
                return
            audio = await self._synthesize_with_google(text, emotion)
            if audio:
                yield audio
                return
            audio = await self._synthesize_with_fish(text)
            if audio:
                yield audio
                return
            audio = await self._synthesize_with_macos(text, emotion, voice_id)
            if audio:
                yield audio
            return

        audio = await self.synthesize(text, emotion, voice_id)
        if audio:
            yield audio

    async def _synthesize_with_minimax(
        self,
        text: str,
        emotion: dict[str, Any] | None = None,
        voice_id: str | None = None,
    ) -> str | None:
        settings = get_settings()
        if not settings.minimax_api_key or not settings.minimax_tts_voice_id:
            return None
        try:
            voice_shape = self._voice_shape(emotion)
            payload = {
                "model": settings.minimax_tts_model,
                "text": self._prepare_minimax_text(text, emotion),
                "stream": False,
                "language_boost": settings.minimax_tts_language_boost,
                "output_format": "hex",
                "voice_setting": {
                    "voice_id": self._minimax_voice_id(voice_id),
                    "speed": self._clamp(settings.minimax_tts_speed * voice_shape["speed"], 0.5, 2.0),
                    "vol": self._clamp(settings.minimax_tts_volume, 0.1, 10.0),
                    "pitch": int(self._clamp(settings.minimax_tts_pitch + voice_shape["pitch"], -12, 12)),
                    "emotion": self._minimax_emotion(emotion),
                    "english_normalization": True,
                },
                "audio_setting": {
                    "sample_rate": settings.minimax_tts_sample_rate,
                    "bitrate": settings.minimax_tts_bitrate,
                    "format": "mp3",
                    "channel": 1,
                },
            }
            headers = {
                "Authorization": f"Bearer {settings.minimax_api_key}",
                "Content-Type": "application/json",
            }
            response = await self._post_minimax_tts(headers, payload)
            response.raise_for_status()
            data = response.json()

            base_resp = data.get("base_resp") if isinstance(data, dict) else None
            if isinstance(base_resp, dict) and base_resp.get("status_code") not in (None, 0):
                raise RuntimeError(str(base_resp.get("status_msg") or "MiniMax TTS failed"))

            audio_hex = ""
            if isinstance(data, dict) and isinstance(data.get("data"), dict):
                audio_hex = str(data["data"].get("audio") or "")
            if not audio_hex:
                raise RuntimeError("MiniMax TTS response contained no audio")
            return base64.b64encode(bytes.fromhex(audio_hex)).decode("ascii")
        except Exception as exc:
            print(f"MiniMax TTS fallback: {exc}")
            return None

    async def _post_minimax_tts(self, headers: dict[str, str], payload: dict[str, Any]) -> httpx.Response:
        try:
            return await self._client().post(get_settings().minimax_tts_endpoint, headers=headers, json=payload)
        except (httpx.ConnectError, httpx.ReadError, httpx.TimeoutException):
            await asyncio.sleep(0.35)
            return await self._client().post(get_settings().minimax_tts_endpoint, headers=headers, json=payload)

    async def _synthesize_with_minimax_stream(
        self,
        text: str,
        emotion: dict[str, Any] | None = None,
        voice_id: str | None = None,
    ) -> AsyncIterator[str]:
        settings = get_settings()
        if not settings.minimax_api_key or not settings.minimax_tts_voice_id:
            return
        try:
            import websockets

            headers = {"Authorization": f"Bearer {settings.minimax_api_key}"}
            ssl_context = ssl.create_default_context()
            async with websockets.connect(
                settings.minimax_tts_ws_endpoint,
                additional_headers=headers,
                ssl=ssl_context,
                open_timeout=settings.minimax_tts_ws_open_timeout,
            ) as websocket:
                connected = json.loads(str(await asyncio.wait_for(websocket.recv(), timeout=settings.minimax_tts_ws_open_timeout)))
                if connected.get("event") != "connected_success":
                    raise RuntimeError(f"MiniMax connection failed: {connected}")

                await websocket.send(json.dumps(self._minimax_task_start_payload(emotion, voice_id)))
                started = json.loads(str(await asyncio.wait_for(websocket.recv(), timeout=settings.minimax_tts_ws_open_timeout)))
                if started.get("event") != "task_started":
                    raise RuntimeError(f"MiniMax task failed to start: {started}")

                await websocket.send(
                    json.dumps(
                        {
                            "event": "task_continue",
                            "text": self._prepare_minimax_text(text, emotion),
                        }
                    )
                )

                while True:
                    message = json.loads(str(await asyncio.wait_for(websocket.recv(), timeout=8)))
                    if message.get("event") == "task_failed":
                        raise RuntimeError(str(message.get("base_resp") or message))
                    data = message.get("data")
                    if isinstance(data, dict):
                        audio_hex = str(data.get("audio") or "")
                        if audio_hex:
                            yield base64.b64encode(bytes.fromhex(audio_hex)).decode("ascii")
                    if message.get("is_final"):
                        break

                await websocket.send(json.dumps({"event": "task_finish"}))
        except Exception as exc:
            self._mark_minimax_stream_failed()
            print(f"MiniMax streaming fallback: {exc}")
            return

    async def _synthesize_with_google(self, text: str, emotion: dict[str, Any] | None = None) -> str | None:
        settings = get_settings()
        if not settings.google_application_credentials or time.monotonic() < self._google_disabled_until:
            return None
        try:
            from google.cloud import texttospeech

            def synthesize() -> bytes:
                voice_shape = self._voice_shape(emotion)
                client = self._get_google_tts_client()
                synthesis_input = texttospeech.SynthesisInput(text=text)
                voice = texttospeech.VoiceSelectionParams(
                    language_code=settings.google_tts_language,
                    name=settings.google_tts_voice,
                )
                audio_config_kwargs = {
                    "audio_encoding": texttospeech.AudioEncoding.MP3,
                    "speaking_rate": self._clamp(settings.google_tts_speaking_rate * voice_shape["speed"], 0.25, 4.0),
                }
                if "chirp" not in settings.google_tts_voice.lower():
                    audio_config_kwargs["pitch"] = self._clamp(settings.google_tts_pitch + voice_shape["pitch"], -20.0, 20.0)
                audio_config = texttospeech.AudioConfig(**audio_config_kwargs)
                response = client.synthesize_speech(
                    input=synthesis_input,
                    voice=voice,
                    audio_config=audio_config,
                )
                return bytes(response.audio_content)

            audio_content = await asyncio.to_thread(synthesize)
            if not audio_content:
                return None
            return base64.b64encode(audio_content).decode("ascii")
        except Exception as exc:
            self._google_disabled_until = time.monotonic() + 90
            print(f"Google TTS fallback: {exc}")
            return None

    def _get_google_tts_client(self) -> Any:
        if self._google_tts_client is not None:
            return self._google_tts_client
        with self._google_tts_client_lock:
            if self._google_tts_client is None:
                from google.cloud import texttospeech

                settings = get_settings()
                os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = settings.google_application_credentials or ""
                self._google_tts_client = texttospeech.TextToSpeechClient()
            return self._google_tts_client

    async def _synthesize_with_fish(self, text: str) -> str | None:
        settings = get_settings()
        if not settings.fish_audio_api_key or not settings.fish_audio_voice_id:
            return None
        try:
            payload = {
                "text": text,
                "format": "mp3",
                "reference_id": settings.fish_audio_voice_id,
                "normalize": True,
                "latency": "normal",
            }
            headers = {
                "Authorization": f"Bearer {settings.fish_audio_api_key}",
                "Content-Type": "application/json",
            }
            async with httpx.AsyncClient(timeout=30) as client:
                response = await client.post("https://api.fish.audio/v1/tts", headers=headers, json=payload)
                response.raise_for_status()
                audio = response.content
            if not audio:
                return None
            return base64.b64encode(audio).decode("ascii")
        except Exception as exc:
            print(f"TTS fallback: {exc}")
            return None

    async def _synthesize_with_macos(
        self,
        text: str,
        emotion: dict[str, Any] | None = None,
        voice_id: str | None = None,
    ) -> str | None:
        """Offline fallback for local demos when cloud speech is unavailable."""
        if not Path("/usr/bin/say").exists() or not Path("/usr/bin/afconvert").exists():
            return None

        def synthesize() -> bytes:
            voice = "Reed (中文（中国大陆）)" if voice_id == "Chinese (Mandarin)_Radio_Host" else "Tingting"
            rate = int(self._clamp(188 * self._voice_shape(emotion)["speed"], 145, 220))
            with tempfile.TemporaryDirectory(prefix="lonelyfm-tts-") as temp_dir:
                aiff_path = Path(temp_dir) / "reply.aiff"
                wav_path = Path(temp_dir) / "reply.wav"
                subprocess.run(
                    ["/usr/bin/say", "-v", voice, "-r", str(rate), "-o", str(aiff_path), text],
                    check=True,
                    capture_output=True,
                )
                subprocess.run(
                    ["/usr/bin/afconvert", "-f", "WAVE", "-d", "LEI16", str(aiff_path), str(wav_path)],
                    check=True,
                    capture_output=True,
                )
                return wav_path.read_bytes()

        try:
            audio = await asyncio.to_thread(synthesize)
            return base64.b64encode(audio).decode("ascii") if audio else None
        except Exception as exc:
            print(f"macOS TTS fallback: {exc}")
            return None

    def _minimax_task_start_payload(self, emotion: dict[str, Any] | None, voice_id: str | None = None) -> dict[str, Any]:
        settings = get_settings()
        voice_shape = self._voice_shape(emotion)
        return {
            "event": "task_start",
            "model": settings.minimax_tts_model,
            "language_boost": settings.minimax_tts_language_boost,
            "voice_setting": {
                "voice_id": self._minimax_voice_id(voice_id),
                "speed": self._clamp(settings.minimax_tts_speed * voice_shape["speed"], 0.5, 2.0),
                "vol": self._clamp(settings.minimax_tts_volume, 0.1, 10.0),
                "pitch": int(self._clamp(settings.minimax_tts_pitch + voice_shape["pitch"], -12, 12)),
                "emotion": self._minimax_emotion(emotion),
                "english_normalization": True,
            },
            "audio_setting": {
                "sample_rate": settings.minimax_tts_sample_rate,
                "bitrate": settings.minimax_tts_bitrate,
                "format": "mp3",
                "channel": 1,
            },
        }

    def _minimax_emotion(self, emotion: dict[str, Any] | None) -> str:
        # Map app emotion -> MiniMax expressive emotion (happy/sad/angry/fearful/neutral)
        # so the voice actually carries 喜怒哀乐 instead of flat calm.
        primary = str((emotion or {}).get("primary") or "calm")
        return {
            "calm": "neutral",
            "joy": "happy",
            "sadness": "sad",
            "fatigue": "sad",
            "anxiety": "fearful",
            "anger": "angry",
            "crisis": "sad",
        }.get(primary, "neutral")

    def _can_try_minimax_stream(self) -> bool:
        return time.monotonic() >= self._minimax_stream_disabled_until

    def _mark_minimax_stream_failed(self) -> None:
        settings = get_settings()
        self._minimax_stream_failure_count += 1
        cooldown = settings.minimax_tts_ws_cooldown_seconds
        if self._minimax_stream_failure_count >= 1:
            self._minimax_stream_disabled_until = time.monotonic() + cooldown

    def _prepare_minimax_text(self, text: str, emotion: dict[str, Any] | None) -> str:
        voice_text = text.strip()
        return voice_text.replace("<", "").replace(">", "")

    def _minimax_voice_id(self, voice_id: str | None = None) -> str:
        clean_voice_id = (voice_id or "").strip()
        if clean_voice_id:
            return clean_voice_id
        return get_settings().minimax_tts_voice_id

    def _voice_shape(self, emotion: dict[str, Any] | None) -> dict[str, float | int]:
        primary = str((emotion or {}).get("primary") or "calm")
        # Keep ONE consistent speaker identity: emotion is carried by the MiniMax emotion
        # param + small speed changes only. Pitch is left at 0 — shifting it re-timbres the
        # voice and makes the same companion sound like a different person.
        shapes: dict[str, dict[str, float | int]] = {
            "calm": {"speed": 1.0, "pitch": 0, "intensity": 0},
            "joy": {"speed": 1.04, "pitch": 0, "intensity": 4},
            "sadness": {"speed": 0.96, "pitch": 0, "intensity": -3},
            "fatigue": {"speed": 0.95, "pitch": 0, "intensity": -3},
            "anxiety": {"speed": 1.05, "pitch": 0, "intensity": 2},
            "anger": {"speed": 1.04, "pitch": 0, "intensity": 3},
            "crisis": {"speed": 0.95, "pitch": 0, "intensity": -5},
        }
        return shapes.get(primary, shapes["calm"])

    def _join_audio_parts(self, parts: list[str]) -> str:
        audio_bytes = b"".join(base64.b64decode(part) for part in parts if part)
        return base64.b64encode(audio_bytes).decode("ascii")

    def _cache_file_path(self, key: str) -> Path:
        digest = hashlib.sha256(key.encode("utf-8")).hexdigest()
        return self._disk_cache_dir / f"{digest}.b64"

    def _read_disk_audio_cache(self, key: str) -> str | None:
        try:
            cache_file = self._cache_file_path(key)
            if not cache_file.exists():
                return None
            audio = cache_file.read_text(encoding="ascii").strip()
            return audio or None
        except Exception:
            return None

    def _write_disk_audio_cache(self, key: str, audio: str) -> None:
        try:
            self._disk_cache_dir.mkdir(parents=True, exist_ok=True)
            self._cache_file_path(key).write_text(audio, encoding="ascii")
        except Exception as exc:
            print(f"TTS disk cache write failed: {exc}")

    def _clamp(self, value: float, minimum: float, maximum: float) -> float:
        return max(minimum, min(maximum, value))


tts_service = TtsService()

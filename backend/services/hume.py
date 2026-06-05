from __future__ import annotations

import asyncio
import json
from typing import Any, TypedDict
from urllib.parse import urlencode

from config import get_settings


class EmotionResult(TypedDict):
    primary: str
    confidence: float
    speech_rate: str
    pitch: str


class HumeService:
    async def analyze_low_latency(self, text: str, prosody: dict[str, Any] | None = None) -> EmotionResult:
        """Return emotion quickly enough for turn-taking; never block voice start on Hume."""
        settings = get_settings()
        fallback = self._local_prosody_emotion(text, prosody)
        if not settings.hume_api_key:
            return fallback
        try:
            return await asyncio.wait_for(self._analyze_text_with_hume(text), timeout=0.35)
        except Exception:
            return fallback

    async def analyze(self, text: str, prosody: dict[str, Any] | None = None) -> EmotionResult:
        settings = get_settings()
        if not settings.hume_api_key:
            return self._local_prosody_emotion(text, prosody)
        try:
            return await self._analyze_text_with_hume(text)
        except Exception as exc:
            print(f"Hume fallback: {exc}")
            return self._local_prosody_emotion(text, prosody)

    async def _analyze_text_with_hume(self, text: str) -> EmotionResult:
        clean_text = text.strip()
        if not clean_text:
            return self._mock_emotion(text)

        try:
            import websockets
        except ImportError as exc:
            raise RuntimeError("websockets package is required for Hume streaming") from exc

        settings = get_settings()
        query = urlencode({"api_key": settings.hume_api_key or ""})
        url = f"{settings.hume_stream_url}?{query}"
        payload = {
            "models": {
                "language": {
                    "granularity": "sentence",
                    "sentiment": {},
                }
            },
            "raw_text": clean_text[:10000],
        }
        async with websockets.connect(url, open_timeout=settings.hume_timeout_seconds) as socket:
            await socket.send(json.dumps(payload))
            raw_message = await socket.recv()

        message = json.loads(str(raw_message))
        if "error" in message:
            raise RuntimeError(str(message["error"]))
        emotions = self._extract_emotions(message)
        if not emotions:
            raise RuntimeError("Hume response contained no emotion scores")
        return self._map_hume_emotions(clean_text, emotions)

    def _extract_emotions(self, message: dict[str, Any]) -> list[dict[str, float | str]]:
        language = message.get("language")
        if not isinstance(language, dict):
            return []
        predictions = language.get("predictions")
        if not isinstance(predictions, list):
            return []
        emotions: list[dict[str, float | str]] = []
        for prediction in predictions:
            if not isinstance(prediction, dict):
                continue
            for emotion in prediction.get("emotions", []):
                if not isinstance(emotion, dict):
                    continue
                name = str(emotion.get("name") or "").strip()
                try:
                    score = float(emotion.get("score") or 0)
                except (TypeError, ValueError):
                    score = 0.0
                if name:
                    emotions.append({"name": name, "score": score})
        return emotions

    def _map_hume_emotions(self, text: str, emotions: list[dict[str, float | str]]) -> EmotionResult:
        if self._looks_like_crisis(text):
            return {"primary": "crisis", "confidence": 0.94, "speech_rate": "slow", "pitch": "low"}

        scores = {str(item["name"]).lower(): float(item["score"]) for item in emotions}
        grouped_scores = {
            "fatigue": self._max_score(scores, ["tiredness", "boredom"]),
            "sadness": self._max_score(
                scores,
                ["sadness", "distress", "disappointment", "empathic pain", "pain", "shame", "guilt", "nostalgia"],
            ),
            "anxiety": self._max_score(scores, ["anxiety", "fear", "horror", "doubt", "awkwardness", "confusion", "surprise (negative)"]),
            "anger": self._max_score(scores, ["anger", "annoyance", "contempt", "disgust", "irritation"]),
            "joy": self._max_score(scores, ["joy", "amusement", "excitement", "enthusiasm", "gratitude", "contentment", "satisfaction"]),
            "calm": self._max_score(scores, ["calmness", "relief", "contentment", "satisfaction"]),
        }
        primary = max(grouped_scores, key=lambda key: grouped_scores[key])
        confidence = grouped_scores[primary]
        if confidence < 0.18:
            primary = "calm"
            confidence = max(grouped_scores["calm"], 0.62)
        speech_rate = "normal"
        pitch = "normal"
        if primary in {"fatigue", "sadness", "crisis"}:
            speech_rate = "slow"
            pitch = "low"
        elif primary in {"joy", "anxiety", "anger"}:
            speech_rate = "fast"
            pitch = "high" if primary == "joy" else "normal"
        return {
            "primary": primary,
            "confidence": round(min(max(confidence, 0.0), 0.99), 2),
            "speech_rate": speech_rate,
            "pitch": pitch,
        }

    def _max_score(self, scores: dict[str, float], names: list[str]) -> float:
        return max((scores.get(name, 0.0) for name in names), default=0.0)

    def _local_prosody_emotion(self, text: str, prosody: dict[str, Any] | None = None) -> EmotionResult:
        normalized = text.lower()
        prosody = prosody or {}
        avg_level = self._float_metric(prosody, "avg_level")
        max_level = self._float_metric(prosody, "max_level")
        chars_per_second = self._float_metric(prosody, "chars_per_second")
        silence_ms = self._float_metric(prosody, "silence_ms")

        if self._looks_like_crisis(normalized):
            return {"primary": "crisis", "confidence": 0.9, "speech_rate": "slow", "pitch": "low"}
        if any(token in normalized for token in ["生气", "气死", "愤怒", "火大", "恼火", "气炸", "太气", "窝火", "可气",
                                                  "angry", "furious", "pissed", "so mad", "irritated", "fed up"]):
            return {"primary": "anger", "confidence": 0.83, "speech_rate": "fast", "pitch": "normal"}
        if any(token in normalized for token in ["慌", "焦虑", "害怕", "紧张", "烦躁",
                                                  "anxious", "panic", "scared", "nervous", "won't stop", "can't stop", "racing", "overwhelmed"]) or (chars_per_second >= 5.2 and max_level >= 0.45):
            return {"primary": "anxiety", "confidence": 0.82, "speech_rate": "fast", "pitch": "normal"}
        if any(token in normalized for token in ["开心", "哈哈", "高兴", "太好了",
                                                  "happy", "excited", "great news", "so glad", "amazing", "yay"]) or (chars_per_second >= 4.2 and avg_level >= 0.24):
            return {"primary": "joy", "confidence": 0.78, "speech_rate": "fast", "pitch": "high"}
        if any(token in normalized for token in ["累", "疲", "困", "没劲",
                                                  "tired", "exhausted", "drained", "worn out", "burnt out", "burned out", "no energy"]) or (chars_per_second <= 2.0 and silence_ms >= 900):
            return {"primary": "fatigue", "confidence": 0.82, "speech_rate": "slow", "pitch": "low"}
        if any(token in normalized for token in ["孤独", "难过", "低落", "一个人", "没人",
                                                  "lonely", "alone", "sad", "down", "no one", "nobody", "miss", "empty"]) or (avg_level <= 0.12 and silence_ms >= 700):
            return {"primary": "sadness", "confidence": 0.84, "speech_rate": "slow", "pitch": "low"}
        return {"primary": "calm", "confidence": 0.66, "speech_rate": "normal", "pitch": "normal"}

    def _float_metric(self, prosody: dict[str, Any], key: str) -> float:
        try:
            return float(prosody.get(key) or 0)
        except (TypeError, ValueError):
            return 0.0

    def _looks_like_crisis(self, text: str) -> bool:
        normalized = text.lower()
        if any(
            token in normalized
            for token in [
                "撑不住", "撑不下去", "撑不下", "扛不住", "扛不下去", "坚持不下去", "顶不住",
                "不想活", "活不下去", "不想活了", "活不下去了", "没法活", "不想撑了",
                "自杀", "轻生", "结束生命", "结束这一切", "解脱",
                "消失", "想消失", "不存在", "没有意义活着", "活着没意思",
                "can't go on", "cant go on", "want to die", "kill myself", "end it all",
                "no reason to live", "give up on life", "can't take it anymore", "cant take it anymore",
            ]
        ):
            return True
        # existential signals: "活着" paired with emptiness (avoids matching casual "好没意思")
        if "活着" in normalized and any(
            token in normalized for token in ["没意思", "没什么意思", "没意义", "没劲", "没价值", "好累"]
        ):
            return True
        return False


hume_service = HumeService()

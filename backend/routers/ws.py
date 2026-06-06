from __future__ import annotations

import asyncio
from collections import Counter
from contextlib import suppress
import time
from typing import Any, Optional, TypedDict

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from models.session import session_store
from prompt.persona import build_prompt
from services.gemma import gemma_service
from services.hume import hume_service
from services.stt import stt_service
from services.tts import tts_service

router = APIRouter()

AudioQueueItem = Optional[str]


class SpeechUnit(TypedDict):
    text: str
    emotion: dict[str, Any]
    pause_ms: int
    low_latency: bool


SpeechQueueItem = Optional[SpeechUnit]
FIRST_RESPONSE_CUE_TEXT = "这句我听懂了。"
CRISIS_SAFETY_REPLY = (
    "我在，这句话我接住了，先别一个人扛着。"
    "你现在能不能联系一个信任的人，跟他说一句：我很难受，能陪我一会儿吗。"
    "如果觉得快撑不住，可以拨打全国心理援助热线 12356，那头一直有人会接你。"
)
ENABLE_AUDIO_CUE = False
CUE_TEXT_BY_EMOTION = {
    "calm": "我听懂了，先抓最像的那一层。",
    "sadness": "这句话里有点沉，我接住了。",
    "fatigue": "这份累我听见了。",
    "anxiety": "先稳一下，这个点我听到了。",
    "joy": "这个感觉是亮的，我听到了。",
    "crisis": "我在，先陪你把这句话放稳。",
}
SENTENCE_ENDINGS = frozenset("。！？!?.")
EARLY_SPEECH_BREAKS = frozenset("，,；;：:、")
MIN_EARLY_SPEECH_CHARS = 5
MAX_FIRST_SPEECH_UNIT_CHARS = 8
MAX_FOLLOWUP_SPEECH_UNIT_CHARS = 30
TARGET_REPLY_CHARS = 64
MAX_REPLY_CHARS = 96
CHUNK_SIZE = 8
ANGER_KEYWORDS = ("生气", "气到", "气死", "火大", "恼火", "窝火", "憋屈")
WRONGED_KEYWORDS = ("委屈", "冤", "被误会", "不公平", "不被理解")
ALLOWED_VOICE_IDS = frozenset(
    {
        "Chinese (Mandarin)_Radio_Host",
        "Chinese (Mandarin)_Warm_Bestie",
        "Chinese (Mandarin)_Mature_Woman",
        "Chinese (Mandarin)_IntellectualGirl",
        "Chinese (Mandarin)_Warm_HeartedGirl",
    }
)
VOICE_PROFILE_NAMES = {
    "linyu": "林屿",
    "awan": "阿婉",
}
COMPANION_NAME_ALIASES = {
    "林屿": ("林屿", "林雨", "淋雨", "林语", "林玉"),
    "阿婉": ("阿婉", "阿晚", "阿宛", "啊晚"),
}
DIRECT_ADDRESS_PREFIXES = (
    "你",
    "我",
    "在",
    "好",
    "嗨",
    "喂",
    "早",
    "晚",
    "能",
    "可以",
    "帮",
    "想",
    "今天",
    "刚才",
    "觉得",
    "为什么",
    "怎么",
)
DIRECT_ADDRESS_ONLY_TAILS = frozenset(
    {
        "",
        "在",
        "在吗",
        "在不在",
        "你在吗",
        "你好",
        "嗨",
        "喂",
        "听得到吗",
        "听得见吗",
        "能听见吗",
        "是你吗",
    }
)
ADDRESS_PUNCTUATION = "，,。！？!?：:；;、~～ "


# ---------------------------------------------------------------------------
# Fast-path helpers
# ---------------------------------------------------------------------------


def answer_product_fact(text: str) -> str | None:
    normalized = text.lower().replace(" ", "")
    mentions_buttons = any(keyword in normalized for keyword in ("按钮", "按键", "重播", "静音", "记忆", "结束"))
    asks_function = any(
        keyword in normalized
        for keyword in (
            "作用", "能用", "有没有用", "有什么用", "什么用", "用处", "功能",
            "可以", "是什么", "干嘛", "干什么", "干啥", "做什么", "怎么用",
        )
    )
    if mentions_buttons and asks_function:
        return "这几个按钮都接了真实动作：重播上一句，静音声音，保存到记忆，结束通话。"
    mentions_gemma = "gemma" in normalized or "模型" in normalized or "大模型" in normalized
    asks_status = any(keyword in normalized for keyword in ("接入", "连上", "是不是", "是否", "用的是", "是什么"))
    if mentions_gemma and asks_status:
        return "已经接入本地 Gemma 4，通过 Ollama 在这台电脑上运行。"
    mentions_latency = any(keyword in normalized for keyword in ("延迟", "慢", "卡", "空白", "没声音", "反应"))
    mentions_voice = any(keyword in normalized for keyword in ("语音", "声音", "回复", "回答", "林屿", "阿婉"))
    if mentions_latency and mentions_voice:
        return "慢主要卡在两段：本地 Gemma 先想第一句，MiniMax 再合成声音。我们现在用更短的首句和预热连接，把第一声尽量提前。"
    return None


def resolve_voice_id(value: object) -> str | None:
    voice_id = str(value or "").strip().strip('"')
    if voice_id in ALLOWED_VOICE_IDS:
        return voice_id
    return None


def resolve_companion_name(value: object) -> str:
    return VOICE_PROFILE_NAMES.get(str(value or "").strip(), "阿婉")


def build_session_greeting(companion_name: str) -> str:
    return "嗨，我在呢。今天过得怎么样？"


def normalize_companion_address(text: str, companion_name: str) -> tuple[str, bool]:
    """Correct common STT variants only when they are being used to address the active companion."""
    clean_text = text.strip()
    aliases = COMPANION_NAME_ALIASES.get(companion_name, (companion_name,))
    for alias in aliases:
        if clean_text == alias:
            return companion_name, True
        if not clean_text.startswith(alias):
            continue
        remainder = clean_text[len(alias) :]
        stripped_remainder = remainder.lstrip(ADDRESS_PUNCTUATION)
        has_address_separator = len(stripped_remainder) != len(remainder)
        if has_address_separator or stripped_remainder.startswith(DIRECT_ADDRESS_PREFIXES):
            separator = "，" if stripped_remainder else ""
            return f"{companion_name}{separator}{stripped_remainder}", True
    return clean_text, False


def is_direct_companion_call(text: str, companion_name: str) -> bool:
    if not text.startswith(companion_name):
        return False
    tail = text[len(companion_name) :].strip(ADDRESS_PUNCTUATION)
    return tail in DIRECT_ADDRESS_ONLY_TAILS


def answer_companion_intent(text: str, history: list[dict[str, str]], companion_name: str = "阿婉") -> str | None:
    normalized = text.lower().replace(" ", "")

    if is_direct_companion_call(normalized, companion_name):
        return "在呢，怎么了？"

    identity_questions = (
        "你是谁",
        "你叫什么",
        "你叫啥",
        "你名字",
        "你叫什么名字",
        "你是阿婉吗",
        "你是阿晚吗",
        "你是林屿吗",
        "你是淋雨吗",
        "你是林雨吗",
    )
    if any(question in normalized for question in identity_questions):
        if companion_name == "林屿":
            return "我是林屿，双木林，岛屿的屿。像月光一样陪你把情绪说完。"
        return "我是阿婉。你刚才是想确认我是谁，还是觉得这个声音有点不一样？"

    # Only keep deterministic social acknowledgements here. Emotional or contextual
    # turns must reach Gemma, otherwise a keyword match can answer the wrong question.
    short_replies = {
        "你好": "你好呀。",
        "在": "我在。",
        "在吗": "我在。",
        "在吗？": "我在。",
        "嗨": "嗨。",
        "嗨~": "嗨~",
        "嗯": "嗯，我在。",
        "嗯嗯": "嗯。",
        "哈": "哈哈。",
        "哈哈": "好。",
        "哈哈哈哈哈": "哈哈，状态不错。",
        "好吧": "嗯，说吧。",
        "嗯好的": "好，我听着。",
        "行": "好，说来听听。",
        "打扰了": "没有打扰，我在这里。",
        "谢谢": "不客气。",
        "辛苦了": "你也是。",
        "晚安": "晚安，你先休息。",
        "拜拜": "下次见。",
        "再见": "下次见。",
    }
    for keyword, reply in short_replies.items():
        is_short_direct_address = len(normalized) <= len(keyword) + 2 and normalized.endswith(keyword)
        if normalized == keyword or is_short_direct_address:
            return reply

    return None


# ---------------------------------------------------------------------------
# WebSocket helpers
# ---------------------------------------------------------------------------


async def send_error(websocket: WebSocket, message: str) -> None:
    await websocket.send_json({"type": "error", "message": message})


async def send_audio_chunk(websocket: WebSocket, audio_base64: str) -> None:
    mime_type = audio_mime_type(audio_base64)
    await websocket.send_json(
        {
            "type": "audio_chunk",
            "data": {"data": audio_base64, "mime_type": mime_type},
        }
    )


async def send_audio_cue(websocket: WebSocket, audio_base64: str) -> None:
    mime_type = audio_mime_type(audio_base64)
    await websocket.send_json(
        {
            "type": "audio_cue",
            "data": {"data": audio_base64, "mime_type": mime_type},
        }
    )


def audio_mime_type(audio_base64: str) -> str:
    try:
        import base64

        if base64.b64decode(audio_base64[:16]).startswith(b"RIFF"):
            return "audio/wav"
    except Exception:
        pass
    return "audio/mpeg"


async def send_ai_chunk(websocket: WebSocket, text: str) -> None:
    await websocket.send_json({"type": "ai_text_chunk", "data": {"text": text, "done": False}})


async def send_memory_sync(websocket: WebSocket, session_id: str) -> None:
    memories = await session_store.memories(session_id)
    await websocket.send_json({"type": "memory_sync", "data": {"memories": memories}})


def chunk_text(text: str, size: int = CHUNK_SIZE) -> list[str]:
    return [text[index : index + size] for index in range(0, len(text), size)]


def should_flush_speech_unit(
    text: str,
    *,
    max_chars: int,
    allow_early_break: bool,
) -> bool:
    unit = text.strip()
    if not unit:
        return False
    tail = unit[-1]
    if tail in SENTENCE_ENDINGS:
        return True
    if allow_early_break and tail in EARLY_SPEECH_BREAKS and len(unit) >= MIN_EARLY_SPEECH_CHARS:
        return True
    return len(unit) >= max_chars


def trim_to_clean_end(text: str) -> str:
    """Trim a force-cut reply so it never ends mid-phrase: keep through the last full
    sentence ending; otherwise end at the last clause boundary and drop the dangling tail."""
    cleaned = text.rstrip()
    if not cleaned:
        return cleaned
    terminal = "." if sum(1 for ch in cleaned if "a" <= ch.lower() <= "z") > len(cleaned) * 0.4 else "。"
    for index in range(len(cleaned) - 1, -1, -1):
        if cleaned[index] in SENTENCE_ENDINGS:
            return cleaned[: index + 1]
    for index in range(len(cleaned) - 1, -1, -1):
        if cleaned[index] in EARLY_SPEECH_BREAKS:
            head = cleaned[:index].rstrip("，,；;：:、 ")
            return f"{head}{terminal}" if head else ""
    return f"{cleaned}{terminal}"


def contextual_voice_emotion(
    current: dict[str, Any], turn_signals: list[dict[str, object]] | None
) -> dict[str, Any]:
    """Context-aware prosody (Sesame-style): the voice follows the conversation's emotional
    arc instead of resetting every turn. A weak/calm current turn inside a sustained emotional
    stretch carries that emotion forward (softened), so the voice doesn't flip-flop calm↔sad."""
    primary = str(current.get("primary") or "calm")
    if primary != "calm":
        return current  # a clear current emotion always leads
    recent = [
        str((signal.get("emotion") or {}).get("primary") or "calm")
        for signal in (turn_signals or [])[-3:]
        if isinstance(signal, dict)
    ]
    non_calm = [emotion for emotion in recent if emotion not in ("calm", "crisis")]
    if len(non_calm) >= 2:
        carried = Counter(non_calm).most_common(1)[0][0]
        return {**current, "primary": carried, "confidence": 0.5}
    return current


def cue_text_for_emotion(emotion: dict[str, Any]) -> str:
    primary = str(emotion.get("primary") or "calm")
    return CUE_TEXT_BY_EMOTION.get(primary, FIRST_RESPONSE_CUE_TEXT)


def contextual_bridge_text(user_text: str, emotion: dict[str, Any]) -> str | None:
    """A short, concrete backchannel that fills model/TTS latency without sounding generic."""
    text = user_text.strip()
    normalized = text.lower().replace(" ", "")
    if len(text) <= 2:
        return None
    if any(keyword in normalized for keyword in ("延迟", "慢", "空白", "卡顿", "没声音", "反应")):
        return "你问的是延迟，"
    if "老板" in text or "领导" in text:
        return "老板那块最耗你，"
    if any(keyword in text for keyword in ("工作", "项目", "比赛", "演示", "测试")):
        return "你说的是这件事，"
    if any(keyword in text for keyword in ("孤独", "一个人", "没人")):
        return "那个孤独感，"
    if any(keyword in text for keyword in ("累", "疲惫", "困", "撑不住")):
        return "这不是普通的累，"
    if any(keyword in text for keyword in ("烦", "焦虑", "慌", "压力")):
        return "最卡的是那股烦，"
    if any(keyword in text for keyword in ("名字", "认识我", "记得我", "记忆")):
        return "你问的是记忆，"
    if any(keyword in text for keyword in ("为什么", "怎么", "如何", "是不是", "能不能", "可以吗")):
        return "你问的是这个点，"
    if emotion.get("primary") in {"sadness", "fatigue"}:
        return "你这句不轻，"
    return None


def build_speech_unit(
    text: str,
    base_emotion: dict[str, Any],
    *,
    low_latency: bool,
) -> SpeechUnit | None:
    clean_text = text.strip()
    if not clean_text:
        return None
    if clean_text[-1] not in SENTENCE_ENDINGS and clean_text[-1] not in EARLY_SPEECH_BREAKS:
        clean_text = f"{clean_text}，"
    pause_ms = 110 if clean_text[-1] in SENTENCE_ENDINGS else 45
    unit_emotion = dict(base_emotion)
    if "?" in clean_text or "？" in clean_text:
        unit_emotion["primary"] = "calm"
    if any(word in clean_text for word in ("累", "空", "难受", "孤独")):
        unit_emotion["primary"] = "sadness" if unit_emotion.get("primary") != "crisis" else "crisis"
    return {
        "text": clean_text,
        "emotion": unit_emotion,
        "pause_ms": pause_ms,
        "low_latency": low_latency,
    }


# ---------------------------------------------------------------------------
# Fast-path: no Gemma needed — reply is already known
# ---------------------------------------------------------------------------

async def handle_fast_path(
    websocket: WebSocket,
    session_id: str,
    user_text: str,
    emotion: dict[str, Any],
    ai_text: str,
    voice_id: str | None,
) -> None:
    """Used for product-fact and companion-intent shortcuts. No streaming needed."""
    await session_store.append(session_id, "user", user_text)
    await session_store.append(session_id, "assistant", ai_text)

    audio_queue: asyncio.Queue[AudioQueueItem] = asyncio.Queue()
    audio_task = asyncio.create_task(_queue_tts(audio_queue, ai_text, emotion, voice_id))
    answer_audio_sent = False

    while True:
        audio_base64 = await audio_queue.get()
        if audio_base64 is None:
            break
        answer_audio_sent = True
        await send_audio_chunk(websocket, audio_base64)

    await audio_task

    if not answer_audio_sent:
        for chunk in chunk_text(ai_text):
            await send_ai_chunk(websocket, chunk)
            await asyncio.sleep(0.015)

    await websocket.send_json(
        {"type": "ai_text_chunk", "data": {"text": ai_text, "done": True, "speak": not answer_audio_sent}}
    )


# ---------------------------------------------------------------------------
# Streaming: Gemma generates tokens → send each chunk immediately
# ---------------------------------------------------------------------------

async def handle_streaming(
    websocket: WebSocket,
    session_id: str,
    user_text: str,
    emotion: dict[str, Any],
    prompt: dict[str, object],
    is_first_turn: bool,
    voice_id: str | None,
    gemma_runtime: dict[str, object] | None = None,
) -> None:
    """
    Calls Gemma via generate_stream() and immediately forwards every token
    chunk to the frontend so the user sees text appear as it is generated.
    """
    await session_store.append(session_id, "user", user_text)

    if ENABLE_AUDIO_CUE:
        cue_text = FIRST_RESPONSE_CUE_TEXT if is_first_turn else cue_text_for_emotion(emotion)
        cue_audio = tts_service.get_cached_cue_audio(cue_text, voice_id)
        if cue_audio:
            await send_audio_cue(websocket, cue_audio)
        else:
            tts_service.prewarm_cue_audio(cue_text, voice_id)

    send_lock = asyncio.Lock()
    audio_queue: asyncio.Queue[AudioQueueItem] = asyncio.Queue()
    speech_queue: asyncio.Queue[SpeechQueueItem] = asyncio.Queue()
    full_text = ""
    sentence_buffer = ""
    first_speech_unit = True
    answer_audio_started = False

    async def send_ai_locked(text: str) -> None:
        async with send_lock:
            await send_ai_chunk(websocket, text)

    async def send_audio_locked(audio_base64: str) -> None:
        nonlocal answer_audio_started
        answer_audio_started = True
        async with send_lock:
            await send_audio_chunk(websocket, audio_base64)

    async def send_json_locked(payload: dict[str, Any]) -> None:
        async with send_lock:
            await websocket.send_json(payload)

    def enqueue_speech_unit(unit: str) -> None:
        nonlocal first_speech_unit
        clean_unit = unit.strip()
        if clean_unit:
            speech_unit = build_speech_unit(clean_unit, emotion, low_latency=first_speech_unit)
            if speech_unit:
                speech_queue.put_nowait(speech_unit)
                first_speech_unit = False

    async def send_contextual_bridge() -> None:
        bridge_text = contextual_bridge_text(user_text, emotion)
        if not bridge_text:
            return
        try:
            audio = await tts_service.synthesize(
                bridge_text,
                emotion,
                voice_id=voice_id,
            )
            if audio and not answer_audio_started:
                async with send_lock:
                    if not answer_audio_started:
                        await send_audio_cue(websocket, audio)
        except Exception as exc:
            print(f"Contextual bridge TTS skipped: {exc}")

    tts_worker = asyncio.create_task(_speech_tts_worker(speech_queue, audio_queue, emotion, voice_id))
    audio_sender = asyncio.create_task(_drain_audio_queue(audio_queue, send_audio_locked))
    bridge_task = asyncio.create_task(send_contextual_bridge())

    try:
        async for token in gemma_service.generate_stream(prompt, user_text, emotion, gemma_runtime):
            if not full_text:
                if token.strip() in {"嗯", "啊", "唉", "呃", "，", ",", "。"}:
                    continue
                token = token.lstrip()  # drop a leading space on the first emitted token
                if not token:
                    continue
            full_text += token
            sentence_buffer += token

            # Send text chunk to frontend immediately
            await send_ai_locked(token)

            # Start TTS as soon as a natural speech unit is ready, not after the whole answer.
            if should_flush_speech_unit(
                sentence_buffer,
                max_chars=MAX_FIRST_SPEECH_UNIT_CHARS if first_speech_unit else MAX_FOLLOWUP_SPEECH_UNIT_CHARS,
                allow_early_break=first_speech_unit,
            ):
                sentence = sentence_buffer
                sentence_buffer = ""
                enqueue_speech_unit(sentence)

            # English needs ~3x the characters of Chinese for the same idea — scale the
            # length caps by the reply's language so English sentences aren't cut short.
            reply_is_english = sum(1 for ch in full_text if "a" <= ch.lower() <= "z") > len(full_text) * 0.4
            target_reply_chars = 116 if reply_is_english else TARGET_REPLY_CHARS
            max_reply_chars = 158 if reply_is_english else MAX_REPLY_CHARS

            token_tail = full_text.strip()[-1:] if full_text.strip() else ""
            if len(full_text) >= target_reply_chars and token_tail in SENTENCE_ENDINGS:
                break
            if len(full_text) >= max_reply_chars:
                if token_tail not in SENTENCE_ENDINGS:
                    # trim the current (un-spoken) sentence to a clean end, keeping full_text
                    # and the TTS buffer consistent so nothing ends mid-phrase
                    prefix_len = len(full_text) - len(sentence_buffer)
                    sentence_buffer = trim_to_clean_end(sentence_buffer)
                    full_text = full_text[:prefix_len] + sentence_buffer
                break

    except asyncio.CancelledError:
        bridge_task.cancel()
        tts_worker.cancel()
        audio_sender.cancel()
        with suppress(asyncio.CancelledError):
            await bridge_task
        with suppress(asyncio.CancelledError):
            await tts_worker
        with suppress(asyncio.CancelledError):
            await audio_sender
        raise
    except Exception as exc:
        print(f"Gemma stream error: {exc}")
        if full_text:
            await send_ai_locked(full_text)
        else:
            await send_json_locked({"type": "error", "message": "生成失败，请重试。"})
            bridge_task.cancel()
            with suppress(asyncio.CancelledError):
                await bridge_task
            await speech_queue.put(None)
            await tts_worker
            await audio_sender
            return

    # Synthesize any remaining sentence buffer
    if sentence_buffer.strip():
        enqueue_speech_unit(sentence_buffer)

    await speech_queue.put(None)
    await tts_worker
    audio_sent = await audio_sender
    if not bridge_task.done():
        bridge_task.cancel()
    with suppress(asyncio.CancelledError):
        await bridge_task

    if audio_sent:
        await session_store.append(session_id, "assistant", full_text)
        await send_json_locked(
            {"type": "ai_text_chunk", "data": {"text": full_text, "done": True, "speak": False}}
        )
    else:
        # No audio (TTS not available) — fall back to text-only chunks
        await session_store.append(session_id, "assistant", full_text)
        await send_json_locked(
            {"type": "ai_text_chunk", "data": {"text": full_text, "done": True, "speak": True}}
        )


# ---------------------------------------------------------------------------
# TTS background tasks (run concurrently with streaming text)
# ---------------------------------------------------------------------------

async def _queue_tts(
    audio_queue: asyncio.Queue[AudioQueueItem],
    ai_text: str,
    emotion: dict[str, Any],
    voice_id: str | None,
) -> None:
    try:
        async for audio_base64 in tts_service.synthesize_stream(ai_text, emotion, voice_id=voice_id):
            await audio_queue.put(audio_base64)
    finally:
        await audio_queue.put(None)


async def _queue_tts_sentence(
    audio_queue: asyncio.Queue[AudioQueueItem],
    sentence: str,
    emotion: dict[str, Any],
    voice_id: str | None,
    low_latency: bool = False,
) -> None:
    """Synthesizes a single sentence and puts audio chunks on the queue."""
    try:
        async for audio_base64 in tts_service.synthesize_stream(
            sentence,
            emotion,
            low_latency=low_latency,
            voice_id=voice_id,
        ):
            await audio_queue.put(audio_base64)
    except Exception as exc:
        print(f"TTS sentence failed: {exc}")


async def _speech_tts_worker(
    speech_queue: asyncio.Queue[SpeechQueueItem],
    audio_queue: asyncio.Queue[AudioQueueItem],
    emotion: dict[str, Any],
    voice_id: str | None,
) -> None:
    try:
        while True:
            speech_unit = await speech_queue.get()
            if speech_unit is None:
                break
            await _queue_tts_sentence(
                audio_queue,
                speech_unit["text"],
                speech_unit["emotion"],
                voice_id,
                low_latency=speech_unit["low_latency"],
            )
            if speech_unit["pause_ms"] > 0:
                await asyncio.sleep(speech_unit["pause_ms"] / 1000)
    finally:
        await audio_queue.put(None)


async def _drain_audio_queue(
    audio_queue: asyncio.Queue[AudioQueueItem],
    send_audio: Any,
) -> bool:
    audio_sent = False
    while True:
        audio_base64 = await audio_queue.get()
        if audio_base64 is None:
            break
        audio_sent = True
        await send_audio(audio_base64)
    return audio_sent


# ---------------------------------------------------------------------------
# Main per-turn handler — dispatches to fast-path or streaming
# ---------------------------------------------------------------------------

async def handle_text(
    websocket: WebSocket,
    session_id: str,
    user_text: str,
    prosody: dict[str, Any] | None = None,
    voice_id: str | None = None,
    companion_name: str = "阿婉",
    gemma_runtime: dict[str, object] | None = None,
) -> None:
    text = user_text.strip()
    if not text:
        text = "我想聊聊今天"
    text, _ = normalize_companion_address(text, companion_name)

    await websocket.send_json({"type": "transcript", "data": {"text": text, "is_final": True}})

    history_task = asyncio.create_task(session_store.history(session_id))
    signals_task = asyncio.create_task(session_store.signals(session_id))
    memories_task = asyncio.create_task(session_store.remember_from_user(session_id, text))

    # Blocking fast-path checks — these run synchronously; if they match we skip Gemma
    ai_text = answer_product_fact(text)
    if not ai_text:
        ai_text = answer_companion_intent(text, [], companion_name)

    emotion: dict[str, Any] = await hume_service.analyze_low_latency(text, prosody)

    # Previous turns' emotional trajectory (read before appending the current one), used to
    # give the VOICE context-aware prosody. The displayed emotion + prompt stay the live read.
    turn_signals = await signals_task
    voice_emotion = contextual_voice_emotion(emotion, turn_signals)

    await session_store.append_signal(session_id, text, emotion, prosody)
    await websocket.send_json({"type": "emotion", "data": emotion})

    # Safety boundary: a detected crisis always gets the same warm, safe guidance —
    # never left to whatever the model happens to generate.
    if emotion.get("primary") == "crisis":
        await handle_fast_path(websocket, session_id, text, emotion, CRISIS_SAFETY_REPLY, voice_id)
        return

    if ai_text:
        # Fast path — skip Gemma entirely (voice carries the conversational arc)
        await handle_fast_path(websocket, session_id, text, voice_emotion, ai_text, voice_id)
        return

    # Streaming path — Gemma needed
    history = await history_task
    memories = await memories_task
    tts_service.prewarm_transport(voice_id)
    prompt = build_prompt(emotion, history, text, prosody, turn_signals, memories, companion_name)
    is_first_turn = not history

    await handle_streaming(websocket, session_id, text, voice_emotion, prompt, is_first_turn, voice_id, gemma_runtime)


# ---------------------------------------------------------------------------
# WebSocket endpoint
# ---------------------------------------------------------------------------

@router.websocket("/ws/chat")
async def chat(websocket: WebSocket) -> None:
    await websocket.accept()
    await session_store.connect()
    active_turn_task: asyncio.Task[None] | None = None
    active_voice_id: str | None = None
    active_companion_name = "阿婉"
    active_model_warmup_task: asyncio.Task[None] | None = None
    active_model_warmup_companion: str | None = None

    def observe_turn_task(task: asyncio.Task[None]) -> None:
        if task.cancelled():
            return
        exc = task.exception()
        if exc:
            print(f"Turn task failed: {exc}")

    def start_turn_task(task: asyncio.Task[None]) -> None:
        nonlocal active_turn_task
        active_turn_task = task
        active_turn_task.add_done_callback(observe_turn_task)

    async def cancel_active_turn() -> None:
        nonlocal active_turn_task
        if not active_turn_task or active_turn_task.done():
            active_turn_task = None
            return
        active_turn_task.cancel()
        with suppress(asyncio.CancelledError):
            await active_turn_task
        active_turn_task = None
        await websocket.send_json({"type": "turn_cancelled"})

    def ensure_model_warmup(companion_name: str) -> asyncio.Task[None]:
        nonlocal active_model_warmup_task, active_model_warmup_companion
        if (
            active_model_warmup_task
            and not active_model_warmup_task.done()
            and active_model_warmup_companion == companion_name
        ):
            return active_model_warmup_task
        active_model_warmup_companion = companion_name
        active_model_warmup_task = asyncio.create_task(gemma_service.prewarm(companion_name))
        return active_model_warmup_task

    def gemma_runtime_from_message(message: dict[str, Any]) -> dict[str, object] | None:
        mode = str(message.get("gemma_mode") or "").strip()
        if mode not in {"local", "cloud"}:
            return None
        runtime: dict[str, object] = {"mode": mode}
        model = str(message.get("gemma_model") or "").strip()
        base_url = str(message.get("gemma_base_url") or "").strip()
        api_key = str(message.get("gemma_api_key") or "").strip()
        if model:
            runtime["model"] = model
        if base_url:
            runtime["base_url"] = base_url
        if api_key:
            runtime["api_key"] = api_key
        return runtime

    try:
        while True:
            message: dict[str, Any] = await websocket.receive_json()
            message_type = message.get("type")
            session_id = str(message.get("session_id") or "anonymous")
            user_id = str(message.get("user_id") or "guest-local")
            message_voice_id = resolve_voice_id(message.get("voice_id"))
            message_companion_name = resolve_companion_name(message.get("voice_profile_id"))
            message_gemma_runtime = gemma_runtime_from_message(message)

            if message_type == "session_start":
                verified_user_id = await session_store.bind_authenticated_user(
                    session_id,
                    str(message.get("access_token") or ""),
                )
                if not verified_user_id:
                    session_store.bind_user(session_id, user_id)
                if message_voice_id:
                    active_voice_id = message_voice_id
                active_companion_name = message_companion_name
                ensure_model_warmup(active_companion_name)
                tts_service.prewarm_google_client()
                tts_service.prewarm_transport(active_voice_id)
                tts_service.prewarm_cue_audio(voice_id=active_voice_id)
                tts_service.prewarm_cue_audio(FIRST_RESPONSE_CUE_TEXT, active_voice_id)
                for cue_text in CUE_TEXT_BY_EMOTION.values():
                    tts_service.prewarm_cue_audio(cue_text, active_voice_id)
                tts_service.prewarm_common_replies(active_voice_id)
                greeting = build_session_greeting(active_companion_name)
                tts_service.prewarm_reply_audio(greeting, active_voice_id)
                await websocket.send_json(
                    {
                        "type": "emotion",
                        "data": {
                            "primary": "calm",
                            "confidence": 0.72,
                            "speech_rate": "normal",
                            "pitch": "normal",
                        },
                    }
                )
                await send_memory_sync(websocket, session_id)
                continue

            if message_type == "session_greeting":
                greeting_started_at = time.monotonic()
                if message_voice_id:
                    active_voice_id = message_voice_id
                active_companion_name = message_companion_name
                greeting = build_session_greeting(active_companion_name)

                model_warmup = ensure_model_warmup(active_companion_name)
                transport_warmup = asyncio.create_task(
                    tts_service.wait_for_transport_prewarm(active_voice_id, timeout=5.0)
                )
                greeting_audio = tts_service.get_cached_reply_audio(greeting, active_voice_id)
                if not greeting_audio:
                    try:
                        greeting_audio = await asyncio.wait_for(
                            tts_service.synthesize(
                                greeting,
                                {"primary": "calm"},
                                voice_id=active_voice_id,
                            ),
                            timeout=6.0,
                        )
                    except asyncio.TimeoutError:
                        greeting_audio = None
                try:
                    await asyncio.wait_for(model_warmup, timeout=35.0)
                except asyncio.TimeoutError:
                    model_warmup.cancel()
                    with suppress(asyncio.CancelledError):
                        await model_warmup
                try:
                    await transport_warmup
                except Exception as exc:
                    print(f"TTS transport warmup skipped: {exc}")

                remaining_connection_time = 1.1 - (time.monotonic() - greeting_started_at)
                if remaining_connection_time > 0:
                    await asyncio.sleep(remaining_connection_time)
                await websocket.send_json({"type": "session_ready", "data": {"greeted": bool(greeting_audio)}})
                if greeting_audio:
                    await send_audio_cue(websocket, greeting_audio)
                continue

            if message_type == "session_end":
                await cancel_active_turn()
                await websocket.close()
                break

            if message_type == "barge_in":
                await cancel_active_turn()
                continue

            if message_type == "memory_save":
                session_store.bind_user(session_id, user_id)
                await session_store.add_memory(session_id, str(message.get("text") or ""))
                await send_memory_sync(websocket, session_id)
                continue

            if message_type == "memory_delete":
                session_store.bind_user(session_id, user_id)
                await session_store.delete_memory(session_id, str(message.get("memory_id") or ""))
                await send_memory_sync(websocket, session_id)
                continue

            if message_type == "text_input":
                session_store.bind_user(session_id, user_id)
                prosody = message.get("prosody")
                if message_voice_id:
                    active_voice_id = message_voice_id
                active_companion_name = message_companion_name
                await cancel_active_turn()
                start_turn_task(
                    asyncio.create_task(
                        handle_text(
                            websocket,
                            session_id,
                            str(message.get("text") or ""),
                            prosody if isinstance(prosody, dict) else None,
                            active_voice_id,
                            active_companion_name,
                            message_gemma_runtime,
                        )
                    )
                )
                continue

            if message_type == "audio_chunk":
                session_store.bind_user(session_id, user_id)
                if message_voice_id:
                    active_voice_id = message_voice_id
                active_companion_name = message_companion_name
                text = await stt_service.transcribe_audio_chunk(
                    str(message.get("data") or ""),
                    str(message.get("mime_type") or "") or None,
                )
                if text:
                    await cancel_active_turn()
                    start_turn_task(
                        asyncio.create_task(
                            handle_text(
                                websocket,
                                session_id,
                                text,
                                voice_id=active_voice_id,
                                companion_name=active_companion_name,
                                gemma_runtime=message_gemma_runtime,
                            )
                        )
                    )
                continue

            await send_error(websocket, "未知消息类型。")
    except WebSocketDisconnect:
        if active_turn_task and not active_turn_task.done():
            active_turn_task.cancel()
        return
    except Exception:
        if active_turn_task and not active_turn_task.done():
            active_turn_task.cancel()
        await send_error(websocket, "服务暂时不可用。")

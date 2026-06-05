from __future__ import annotations

import json
from collections.abc import AsyncIterator

import httpx

from config import get_settings


def _is_gemma4_model(value: str) -> bool:
    normalized = value.strip().lower()
    return normalized == "gemma4" or normalized.startswith("gemma4:")


def _select_gemma4_model(models: list[str], requested_model: str) -> str | None:
    if requested_model in models:
        return requested_model
    requested_latest = f"{requested_model}:latest"
    if requested_latest in models:
        return requested_latest
    return next((model for model in models if _is_gemma4_model(model)), None)


class GemmaService:
    def _local_http_client(self, timeout: float) -> httpx.AsyncClient:
        # Local model servers should never be routed through system HTTP proxies.
        return httpx.AsyncClient(timeout=timeout, trust_env=False)

    async def status(self) -> dict[str, object]:
        settings = get_settings()
        if settings.gemma_provider != "local":
            return {
                "provider": settings.gemma_provider,
                "available": bool(settings.google_ai_api_key),
                "model": settings.gemma_model,
            }
        try:
            if settings.local_gemma_provider.lower() == "openai":
                return await self._openai_compatible_status()
            return await self._ollama_status()
        except Exception as exc:
            return {
                "provider": "local",
                "local_provider": settings.local_gemma_provider,
                "base_url": settings.local_gemma_base_url,
                "model": settings.gemma_model,
                "available": False,
                "error": str(exc),
            }

    async def prewarm(self, companion_name: str = "阿婉") -> None:
        """Load the model AND warm the persona-prompt KV cache so the first real turn is fast.

        The big static rule block in the system prompt is the stable cacheable prefix; by sending
        it here, Ollama caches it and the first real user turn only re-evaluates the small volatile
        tail instead of the full ~1400-token prompt.
        """
        settings = get_settings()
        if settings.gemma_provider != "local":
            return
        if settings.local_gemma_provider.lower() == "openai":
            return  # OpenAI-compatible servers manage their own warmup
        try:
            from prompt.persona import build_prompt

            neutral_emotion = {"primary": "calm", "confidence": 0.72, "speech_rate": "normal", "pitch": "normal"}
            prompt = build_prompt(neutral_emotion, [], "今天有点累", None, None, None, companion_name)
            endpoint = f"{settings.local_gemma_base_url.rstrip('/')}/api/chat"
            payload = {
                "model": settings.gemma_model,
                "messages": self._to_chat_messages(prompt),
                "stream": False,
                "think": False,
                "keep_alive": -1,
                "options": {"num_predict": 1, "num_ctx": 4096},
            }
            async with self._local_http_client(timeout=60) as client:
                await client.post(endpoint, json=payload)
        except Exception as exc:
            print(f"Gemma prewarm skipped: {exc}")

    async def generate(self, prompt: dict[str, object], user_text: str, emotion: dict[str, object]) -> str:
        settings = get_settings()
        if settings.gemma_provider == "local":
            try:
                text = await self._generate_with_local_model(prompt)
                return self._remove_user_echo(text, user_text)
            except Exception as exc:
                print(f"Local Gemma fallback: {exc}")
                return self._mock_response(user_text, emotion)

        if not settings.google_ai_api_key:
            return self._mock_response(user_text, emotion)
        try:
            text = await self._generate_with_gemini_api(prompt)
            return self._remove_user_echo(text, user_text)
        except Exception as exc:
            print(f"Gemma API fallback: {exc}")
            return "我先帮你抓重点，哪一段最卡你？"

    async def generate_stream(
        self,
        prompt: dict[str, object],
        user_text: str,
        emotion: dict[str, object],
        runtime: dict[str, object] | None = None,
    ) -> AsyncIterator[str]:
        """Yields text chunks as the model generates tokens. Falls back to non-streaming on error."""
        settings = get_settings()
        runtime_mode = str((runtime or {}).get("mode") or settings.gemma_provider)
        if runtime_mode == "local":
            try:
                async for chunk in self._stream_with_local_model(prompt, runtime):
                    yield chunk
                return
            except Exception as exc:
                print(f"Local stream fallback: {exc}")

        runtime_api_key = str((runtime or {}).get("api_key") or "").strip()
        if not runtime_api_key and not settings.google_ai_api_key:
            yield self._mock_response(user_text, emotion)
            return
        try:
            text = await self._generate_with_gemini_api(prompt, runtime)
            yield self._clean_response(text)
        except Exception as exc:
            print(f"Gemma API stream fallback: {exc}")
            yield "我先帮你抓重点，哪一段最卡你？"

    async def _stream_with_local_model(
        self,
        prompt: dict[str, object],
        runtime: dict[str, object] | None = None,
    ) -> AsyncIterator[str]:
        settings = get_settings()
        provider = settings.local_gemma_provider.lower()
        if provider == "openai":
            async for chunk in self._stream_openai(prompt):
                yield chunk
        else:
            async for chunk in self._stream_ollama(prompt, runtime):
                yield chunk

    async def _stream_ollama(
        self,
        prompt: dict[str, object],
        runtime: dict[str, object] | None = None,
    ) -> AsyncIterator[str]:
        settings = get_settings()
        base_url = str((runtime or {}).get("base_url") or settings.local_gemma_base_url)
        model = str((runtime or {}).get("model") or settings.gemma_model)
        endpoint = f"{base_url.rstrip('/')}/api/chat"
        messages = self._to_chat_messages(prompt)
        payload = {
            "model": model,
            "messages": messages,
            "stream": True,
            "think": False,
            "keep_alive": -1,
            "options": {
                "temperature": 0.64,
                "top_p": 0.9,
                "num_predict": 96,
                "num_ctx": 4096,
            },
        }
        async with self._local_http_client(timeout=60) as client:
            async with client.stream("POST", endpoint, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    content = str(data.get("message", {}).get("content", "") or "")
                    if content:
                        cleaned = self._clean_token(content)
                        if cleaned:
                            yield cleaned

    async def _stream_openai(self, prompt: dict[str, object]) -> AsyncIterator[str]:
        settings = get_settings()
        endpoint = f"{settings.local_gemma_base_url.rstrip('/')}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        if settings.local_gemma_api_key:
            headers["Authorization"] = f"Bearer {settings.local_gemma_api_key}"
        payload = {
            "model": settings.gemma_model,
            "messages": self._to_chat_messages(prompt),
            "temperature": 0.72,
            "top_p": 0.9,
            "max_tokens": 140,
            "stream": True,
        }
        async with self._local_http_client(timeout=60) as client:
            async with client.stream("POST", endpoint, headers=headers, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if line.strip() == "data: [DONE]" or not line.startswith("data: "):
                        continue
                    data = json.loads(line[6:])
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    content = str(delta.get("content", ""))
                    if content:
                        cleaned = self._clean_token(content)
                        if cleaned:
                            yield cleaned

    def _clean_token(self, token: str) -> str:
        """Minimal post-processing applied to each raw token during streaming.
        Must NOT strip spaces — English word separators live in the token whitespace."""
        for marker in ("**", "阿晚：", "阿晚:", "林屿：", "林屿:", "「", "」", """, """, '"'):
            token = token.replace(marker, "")
        stripped = token.strip()
        if not stripped:
            return ""
        if "\U0001F300" <= stripped[0] <= "\U0001FAFF" or (
            len(stripped) == 1 and "\U00002700" <= stripped[0] <= "\U000027BF"
        ):
            return ""
        return token

    async def _generate_with_local_model(self, prompt: dict[str, object]) -> str:
        settings = get_settings()
        provider = settings.local_gemma_provider.lower()
        if provider == "openai":
            return await self._generate_with_openai_compatible(prompt)
        return await self._generate_with_ollama(prompt)

    async def _generate_with_ollama(self, prompt: dict[str, object]) -> str:
        settings = get_settings()
        endpoint = f"{settings.local_gemma_base_url.rstrip('/')}/api/chat"
        messages = self._to_chat_messages(prompt)
        payload = {
            "model": settings.gemma_model,
            "messages": messages,
            "stream": False,
            "think": False,
            "keep_alive": -1,
            "options": {
                "temperature": 0.64,
                "top_p": 0.9,
                "num_predict": 96,
                "num_ctx": 4096,
            },
        }
        async with self._local_http_client(timeout=45) as client:
            response = await client.post(endpoint, json=payload)
            response.raise_for_status()
            data = response.json()
        text = str(data.get("message", {}).get("content", "") or data.get("response", "")).strip()
        if not text:
            raise RuntimeError("Local Ollama response contained no text")
        return self._clean_response(text)

    async def _generate_with_openai_compatible(self, prompt: dict[str, object]) -> str:
        settings = get_settings()
        endpoint = f"{settings.local_gemma_base_url.rstrip('/')}/v1/chat/completions"
        headers = {"Content-Type": "application/json"}
        if settings.local_gemma_api_key:
            headers["Authorization"] = f"Bearer {settings.local_gemma_api_key}"
        payload = {
            "model": settings.gemma_model,
            "messages": self._to_chat_messages(prompt),
            "temperature": 0.72,
            "top_p": 0.9,
            "max_tokens": 140,
            "stream": False,
        }
        async with self._local_http_client(timeout=45) as client:
            response = await client.post(endpoint, headers=headers, json=payload)
            response.raise_for_status()
            data = response.json()
        choices = data.get("choices", [])
        if not choices:
            raise RuntimeError("Local OpenAI-compatible response contained no choices")
        text = str(choices[0].get("message", {}).get("content", "")).strip()
        if not text:
            raise RuntimeError("Local OpenAI-compatible response contained no text")
        return self._clean_response(text)

    def _to_chat_messages(self, prompt: dict[str, object]) -> list[dict[str, str]]:
        messages: list[dict[str, str]] = [{"role": "system", "content": str(prompt.get("system", ""))}]
        source_messages = prompt.get("messages", [])
        if not isinstance(source_messages, list):
            return messages
        for message in source_messages:
            if not isinstance(message, dict):
                continue
            role = str(message.get("role", "user"))
            if role not in {"user", "assistant", "system"}:
                role = "user"
            content = str(message.get("content", "")).strip()
            if content:
                messages.append({"role": role, "content": content})
        return messages

    async def _ollama_status(self) -> dict[str, object]:
        settings = get_settings()
        endpoint = f"{settings.local_gemma_base_url.rstrip('/')}/api/tags"
        async with self._local_http_client(timeout=5) as client:
            response = await client.get(endpoint)
            response.raise_for_status()
            data = response.json()
        models = [
            str(model.get("name", ""))
            for model in data.get("models", [])
            if isinstance(model, dict)
        ]
        requested_model = settings.gemma_model
        selected_model = _select_gemma4_model(models, requested_model)
        available = bool(selected_model)
        return {
            "provider": "local",
            "local_provider": "ollama",
            "base_url": settings.local_gemma_base_url,
            "model": requested_model,
            "selected_model": selected_model,
            "available": available,
            "models": models,
        }

    async def _openai_compatible_status(self) -> dict[str, object]:
        settings = get_settings()
        endpoint = f"{settings.local_gemma_base_url.rstrip('/')}/v1/models"
        headers = {}
        if settings.local_gemma_api_key:
            headers["Authorization"] = f"Bearer {settings.local_gemma_api_key}"
        async with self._local_http_client(timeout=5) as client:
            response = await client.get(endpoint, headers=headers)
            response.raise_for_status()
            data = response.json()
        models = [
            str(model.get("id", ""))
            for model in data.get("data", [])
            if isinstance(model, dict)
        ]
        return {
            "provider": "local",
            "local_provider": "openai",
            "base_url": settings.local_gemma_base_url,
            "model": settings.gemma_model,
            "available": settings.gemma_model in models or bool(models),
            "models": models,
        }

    async def _generate_with_gemini_api(
        self,
        prompt: dict[str, object],
        runtime: dict[str, object] | None = None,
    ) -> str:
        settings = get_settings()
        model = str((runtime or {}).get("model") or settings.gemma_model)
        api_key = str((runtime or {}).get("api_key") or settings.google_ai_api_key or "")
        endpoint = (
            "https://generativelanguage.googleapis.com/v1beta/"
            f"models/{model}:generateContent"
        )
        system = str(prompt.get("system", ""))
        messages = prompt.get("messages", [])
        if not isinstance(messages, list):
            messages = []

        conversation = "\n".join(
            f"{message.get('role', 'user')}: {message.get('content', '')}"
            for message in messages
            if isinstance(message, dict)
        )
        request_body = {
            "systemInstruction": {"parts": [{"text": system}]},
            "contents": [
                {
                    "role": "user",
                    "parts": [{"text": conversation}],
                }
            ],
            "generationConfig": {
                "temperature": 0.72,
                "topP": 0.9,
                "maxOutputTokens": 140,
            },
        }
        headers = {
            "Content-Type": "application/json",
            "x-goog-api-key": api_key,
        }
        async with httpx.AsyncClient(timeout=20) as client:
            response = await client.post(endpoint, headers=headers, json=request_body)
            response.raise_for_status()
            payload = response.json()
        candidates = payload.get("candidates", [])
        if not candidates:
            raise RuntimeError("Gemma response contained no candidates")
        parts = candidates[0].get("content", {}).get("parts", [])
        text = "".join(str(part.get("text", "")) for part in parts if isinstance(part, dict)).strip()
        if not text:
            raise RuntimeError("Gemma response contained no text")
        return self._clean_response(text)

    def _clean_response(self, text: str) -> str:
        cleaned = text.strip().strip("\"“”")
        for marker in ("**", "阿晚：", "阿晚:", "林屿：", "林屿:"):
            cleaned = cleaned.replace(marker, "")
        for quote in ("「", "」", "“", "”", "\""):
            cleaned = cleaned.replace(quote, "")
        cleaned = self._remove_emoji(cleaned)
        cleaned = cleaned.replace("…… ", "……").replace(" ...", "……").replace("...", "……")
        lines = [line.strip("- 0123456789.、") for line in cleaned.splitlines() if line.strip()]
        if lines:
            cleaned = "".join(lines[:3])
        cleaned = self._remove_non_companion_sentences(cleaned)
        cleaned = self._normalize_tone(cleaned)
        cleaned = self._remove_question_ending(cleaned)
        cleaned = self._keep_brief_response(cleaned)
        if len(cleaned) > 86:
            punctuation_indexes = [
                index
                for index, char in enumerate(cleaned[:86])
                if index >= 48 and char in "，,。！？!?……"
            ]
            if punctuation_indexes:
                cleaned = cleaned[: punctuation_indexes[-1] + 1]
            else:
                cleaned = f"{cleaned[:86].rstrip('，,、；; ')}。"
        return cleaned or "这句我没听完整，你把最后半句再说一次。"

    def _keep_brief_response(self, text: str) -> str:
        cleaned = text.strip()
        sentences: list[str] = []
        start = 0
        for index, char in enumerate(cleaned):
            if char not in "。！？!?":
                continue
            sentence = cleaned[start : index + 1].strip()
            start = index + 1
            if sentence:
                sentences.append(sentence)
            if len("".join(sentences)) >= 68 or len(sentences) >= 3:
                break
        if not sentences:
            return cleaned
        brief = "".join(sentences).strip()
        return brief if len(brief) <= 92 else "".join(sentences[:2]).strip()

    def _remove_emoji(self, text: str) -> str:
        return "".join(
            char
            for char in text
            if not (
                "\U0001F300" <= char <= "\U0001FAFF"
                or "\U00002700" <= char <= "\U000027BF"
                or "\U00002600" <= char <= "\U000026FF"
            )
        ).strip()

    def _normalize_tone(self, text: str) -> str:
        cleaned = text.strip()
        replacements = {
            "你想从哪个点开始说起呢": "你从最清楚的那一段开始",
            "你想从哪个点开始说起": "你从最清楚的那一段开始",
            "从哪个点开始": "从最清楚的那一段开始",
            "慢慢来": "先说这一句",
            "慢慢聊": "接着聊",
            "我在这里陪着你": "我听着",
            "我在这儿陪着你": "我听着",
            "都可以告诉我": "挑最想说的讲",
            "你想说点什么都可以": "挑最想说的讲",
            "洗耳恭听": "我跟得上",
            "没事的，": "",
            "没事的": "",
            "没关系，": "",
            "没关系": "",
            "咱们": "我们",
            "陪着你": "听你说",
            "后台处理数据量太大": "本地模型和语音合成还在接力",
            "后台处理的数据量太大": "本地模型和语音合成还在接力",
            "模型还在思考怎么给出最好的答案": "Gemma 先生成文字，TTS 再把它变成声音",
            "需要放慢一点节奏": "确实有点累了",
            "可以稍微停下来喘口气": "先把最累的那一块说出来",
            "可以先歇一会儿": "先把最累的那一块说出来",
            "可以歇一会儿": "先把最累的那一块说出来",
            "是有点累，就让它这样就好": "先把最累的那一块说出来",
            "就让它这样就好": "先把最累的那一块说出来",
            "没用这个感觉": "这个感觉",
            "能具体说说，是哪方面让你感觉特别卡住了吗": "先说哪件事让你这样看自己",
            "能具体说一下，是哪件事让你觉得值得聊聊呢": "先说今天最卡你的那一段",
            "先说今天最卡你的那一段？": "先说今天最卡你的那一段。",
            "有什么想分享的吗": "先说今天最卡你的那一段",
            "情绪来源": "这股劲从哪来",
            "关系结构": "你们之间的相处方式",
            "内在冲突": "心里两边在拉扯",
            "价值衡量标准": "你心里那把尺",
            "价值衡量": "你心里那把尺",
            "付出代价": "放弃点什么",
            "给人生下结论": "把这事说死",
            "真正接住": "真的懂你",
            "无意义感": "这种没意思的感觉",
            "它往往不是": "这不一定是",
            "单纯": "只是",
            "具体的事": "某件事",
            "暂时失灵": "暂时不管用了",
            "整体": "整个人",
            "否定自己": "把自己否了",
        }
        for source, target in replacements.items():
            cleaned = cleaned.replace(source, target)
        if not cleaned.strip(" 。！？!?，,、"):
            return "这句我没听完整，你把最后半句再说一次。"
        return cleaned.strip()

    def _remove_question_ending(self, text: str) -> str:
        cleaned = text.strip()
        if "？" not in cleaned and "?" not in cleaned:
            return cleaned
        if self._has_useful_followup_question(cleaned):
            return cleaned.replace("?", "？")
        if cleaned.startswith(("你好", "嗨", "哈喽", "hello", "Hello")):
            return "你好呀。我们接着聊。"
        first_clause = cleaned.replace("?", "？").split("？", 1)[0].strip(" ，,。")
        if not first_clause:
            return "我只听清前半句，你把后面那点再说一次。"
        if len(first_clause) <= 8:
            return f"{first_clause}。我们接着聊。"
        return f"{first_clause}。我跟得上。"

    def _has_useful_followup_question(self, text: str) -> bool:
        question_text = text.replace("?", "？")
        useful_markers = (
            "还是",
            "哪",
            "哪个",
            "哪一",
            "最",
            "谁",
            "要不要",
            "我先",
            "先",
            "身体",
            "心里",
            "卡",
            "刺",
            "耗",
        )
        generic_markers = ("想聊什么", "想说什么", "有什么想分享", "怎么了", "还好吗")
        return "？" in question_text and any(marker in question_text for marker in useful_markers) and not any(
            marker in question_text for marker in generic_markers
        )

    def _remove_non_companion_sentences(self, text: str) -> str:
        sentences: list[str] = []
        current = ""
        advice_markers = (
            "应该",
            "你要",
            "你得",
            "得让",
            "试着",
            "不妨",
            "建议",
            "休息一下",
            "歇一会儿",
            "放松一下",
            "放松下来",
            "不用想太多",
            "什么都不用想",
        )
        for char in text:
            current += char
            if char in "。！？!?":
                sentence = current.strip()
                current = ""
                if not sentence:
                    continue
                if ("？" in sentence or "?" in sentence) and not self._has_useful_followup_question(sentence):
                    continue
                if any(marker in sentence for marker in advice_markers):
                    softened_sentence = self._strip_advice_clause(sentence, advice_markers)
                    if softened_sentence:
                        sentences.append(softened_sentence)
                    continue
                sentences.append(sentence)
        tail = current.strip()
        if tail and ("？" not in tail and "?" not in tail or self._has_useful_followup_question(tail)) and not any(
            marker in tail for marker in advice_markers
        ):
            sentences.append(tail)
        cleaned = "".join(sentences).strip()
        return cleaned

    def _strip_advice_clause(self, sentence: str, advice_markers: tuple[str, ...]) -> str:
        ending = sentence[-1] if sentence and sentence[-1] in "。！？!?" else "。"
        body = sentence.rstrip("。！？!?")
        clauses: list[str] = []
        current = ""
        for char in body:
            if char in "，,；;、":
                if current.strip():
                    clauses.append(current.strip())
                current = ""
                continue
            current += char
        if current.strip():
            clauses.append(current.strip())
        kept = [clause for clause in clauses if not any(marker in clause for marker in advice_markers)]
        if not kept:
            return ""
        return f"{'，'.join(kept)}{ending}"

    def _remove_user_echo(self, text: str, user_text: str) -> str:
        user_clean = user_text.strip(" 。！？!?，,、")
        if not user_clean:
            return text
        sentences: list[str] = []
        current = ""
        for char in text:
            current += char
            if char in "。！？!?":
                sentence = current.strip()
                current = ""
                sentence_clean = sentence.strip(" 。！？!?，,、")
                is_short_echo = (
                    len(sentence_clean) <= max(len(user_clean) + 4, 12)
                    and (sentence_clean in user_clean or user_clean in sentence_clean)
                )
                if not is_short_echo:
                    sentences.append(sentence)
        if current.strip():
            sentences.append(current.strip())
        cleaned = "".join(sentences).strip()
        return cleaned or text

    def _mock_response(self, user_text: str, emotion: dict[str, object]) -> str:
        primary = emotion.get("primary", "calm")
        if primary == "crisis":
            return "我在。现在先联系一个真实的人陪你，给信任的人发一句：我需要你。"
        if primary == "fatigue":
            return "这不是普通的累，像是撑久了。先说最耗你的那一件事。"
        if primary == "joy":
            return "听起来状态不错。这个劲头挺好，我们接着聊。"
        if primary == "anxiety":
            return "先把注意力收回来一点。你现在说一句就够。"
        if primary == "sadness":
            return "听起来有点难受。但我们先抓住眼前这一小步。"
        if "今天好累" in user_text:
            return "辛苦了。先别复盘，挑最想说的一件事就好。"
        return "这句我没听全。你把最关键的那半句再说一次。"


gemma_service = GemmaService()

from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from typing import Any

try:
    from redis.asyncio import Redis
except ImportError:  # pragma: no cover
    Redis = None  # type: ignore[assignment]

from config import get_settings
from services.supabase_memory import supabase_memory_service


class SessionStore:
    _DURABLE_MEMORY_PATTERNS: tuple[tuple[str, re.Pattern[str], str], ...] = (
        ("name", re.compile(r"(?:我叫|我的名字是|你可以叫我)([\u4e00-\u9fffA-Za-z·]{2,20})"), "用户叫{name}"),
        ("location", re.compile(r"(?:我住在|我现在住在|我搬到)([^，。！？!?]{2,24})"), "用户住在{value}"),
        ("work", re.compile(r"(?:我的工作是|我是做|我从事)([^，。！？!?]{2,28})"), "用户从事{value}"),
        ("preference", re.compile(r"(?:我喜欢|我最喜欢)([^，。！？!?]{2,28})"), "用户喜欢{value}"),
        ("dislike", re.compile(r"(?:我不喜欢|我讨厌)([^，。！？!?]{2,28})"), "用户不喜欢{value}"),
        ("relationship", re.compile(r"(?:我(?:男朋友|女朋友|对象|伴侣|老公|老婆)叫)([\u4e00-\u9fffA-Za-z·]{2,20})"), "用户的伴侣叫{name}"),
        ("project", re.compile(r"(?:我在做|我正在做|我最近在做)([^，。！？!?]{2,32})"), "用户正在做{value}"),
        ("event", re.compile(r"((?:明天|后天|下周|下个月|周[一二三四五六日天])(?:要|准备|会去)[^，。！？!?]{2,36})"), "用户{value}"),
    )

    def __init__(self) -> None:
        self._memory: defaultdict[str, list[dict[str, str]]] = defaultdict(list)
        self._signals: defaultdict[str, list[dict[str, object]]] = defaultdict(list)
        self._session_users: dict[str, str] = {}
        self._session_tokens: dict[str, str] = {}
        self._users: dict[str, dict[str, Any]] = {}
        self._data_path = Path(__file__).resolve().parents[2] / ".data" / "lonelyfm-memory.json"
        self._redis: Redis | None = None
        self._load()

    async def connect(self) -> None:
        if Redis is None:
            return
        try:
            self._redis = Redis.from_url(get_settings().redis_url, decode_responses=True)
            await self._redis.ping()
        except Exception:
            self._redis = None

    def bind_user(self, session_id: str, user_id: str | None) -> str:
        if session_id in self._session_tokens and session_id in self._session_users:
            return self._session_users[session_id]
        user_key = self._normalize_user_id(user_id)
        self._session_users[session_id] = user_key
        if not self._is_temporary_user(user_key):
            self._ensure_user(user_key)
        return user_key

    async def bind_authenticated_user(self, session_id: str, access_token: str | None) -> str | None:
        if not access_token or not get_settings().supabase_configured:
            return None
        try:
            user_id = await supabase_memory_service.verify_user(access_token)
            if not user_id:
                return None
            self._session_tokens[session_id] = access_token
            self.bind_user(session_id, user_id)
            await self._load_cloud_memories(session_id)
            return user_id
        except Exception as exc:
            print(f"Supabase auth fallback: {exc}")
            return None

    async def append(self, session_id: str, role: str, content: str) -> None:
        key = self._key(session_id)
        message = {
            "role": role,
            "content": content,
            "created_at": self._now(),
        }
        self._memory[key].append({"role": role, "content": content})
        self._memory[key] = self._memory[key][-12:]
        if self._is_temporary_user(key):
            return
        user_record = self._ensure_user(key)
        user_record["messages"].append(message)
        user_record["messages"] = user_record["messages"][-80:]
        self._save()

    async def history(self, session_id: str) -> list[dict[str, str]]:
        key = self._key(session_id)
        if self._is_temporary_user(key):
            return self._memory[key][-12:]
        if not self._memory[key]:
            user_record = self._ensure_user(key)
            self._memory[key] = [
                {"role": str(item.get("role") or ""), "content": str(item.get("content") or "")}
                for item in user_record.get("messages", [])[-12:]
                if item.get("role") and item.get("content")
            ]
        return self._memory[key][-12:]

    async def append_signal(
        self,
        session_id: str,
        user_text: str,
        emotion: dict[str, object],
        prosody: dict[str, object] | None,
    ) -> None:
        key = self._key(session_id)
        signal = {
            "text": user_text[:42],
            "emotion": emotion,
            "prosody": prosody or {},
            "created_at": self._now(),
        }
        self._signals[key].append(
            {
                "text": user_text[:42],
                "emotion": emotion,
                "prosody": prosody or {},
            }
        )
        self._signals[key] = self._signals[key][-6:]
        if self._is_temporary_user(key):
            return
        user_record = self._ensure_user(key)
        user_record["signals"].append(signal)
        user_record["signals"] = user_record["signals"][-24:]
        self._save()

    async def signals(self, session_id: str) -> list[dict[str, object]]:
        key = self._key(session_id)
        if self._is_temporary_user(key):
            return self._signals[key][-6:]
        if not self._signals[key]:
            user_record = self._ensure_user(key)
            self._signals[key] = [
                {
                    "text": item.get("text", ""),
                    "emotion": item.get("emotion", {}),
                    "prosody": item.get("prosody", {}),
                }
                for item in user_record.get("signals", [])[-6:]
            ]
        return self._signals[key][-6:]

    async def memories(self, session_id: str) -> list[dict[str, str]]:
        if self._is_temporary_user(self._key(session_id)):
            return []
        user_record = self._ensure_user(self._key(session_id))
        return [
            {
                "id": str(item.get("id") or ""),
                "text": str(item.get("text") or ""),
                "createdAt": str(item.get("createdAt") or item.get("created_at") or ""),
            }
            for item in user_record.get("memories", [])
            if item.get("id") and item.get("text")
        ][:12]

    async def add_memory(self, session_id: str, text: str) -> list[dict[str, str]]:
        if self._is_temporary_user(self._key(session_id)):
            return []
        normalized = text.strip()
        if not normalized:
            return await self.memories(session_id)
        user_record = self._ensure_user(self._key(session_id))
        memories = user_record["memories"]
        if not any(str(item.get("text") or "").strip() == normalized for item in memories):
            memories.insert(
                0,
                {
                    "id": f"mem-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
                    "text": normalized[:120],
                    "createdAt": self._now(),
                },
            )
            user_record["memories"] = memories[:12]
            self._save()
            await self._sync_memory(session_id, user_record["memories"][0])
        return await self.memories(session_id)

    async def remember_from_user(self, session_id: str, text: str) -> list[dict[str, str]]:
        """Extract explicit, durable facts without adding another LLM call to the voice path."""
        if self._is_temporary_user(self._key(session_id)):
            return []
        normalized = text.strip()
        if not normalized or len(normalized) > 180:
            return await self.memories(session_id)

        user_record = self._ensure_user(self._key(session_id))
        changed = False
        for category, pattern, template in self._DURABLE_MEMORY_PATTERNS:
            match = pattern.search(normalized)
            if not match:
                continue
            value = match.group(1).strip(" ，。！？!?、")
            if not value or self._looks_temporary(value):
                continue
            memory_text = template.format(name=value, value=value)[:120]
            memories = user_record["memories"]
            existing = next((item for item in memories if item.get("category") == category), None)
            if existing:
                if existing.get("text") == memory_text:
                    continue
                existing.update({"text": memory_text, "updatedAt": self._now(), "source": "automatic"})
            else:
                memories.insert(
                    0,
                    {
                        "id": f"mem-{int(datetime.now(timezone.utc).timestamp() * 1000)}-{category}",
                        "text": memory_text,
                        "category": category,
                        "source": "automatic",
                        "createdAt": self._now(),
                    },
                )
            user_record["memories"] = memories[:24]
            changed = True
        if changed:
            self._save()
            for item in user_record["memories"]:
                if item.get("source") == "automatic":
                    await self._sync_memory(session_id, item)
        return await self.memories(session_id)

    async def delete_memory(self, session_id: str, memory_id: str) -> list[dict[str, str]]:
        if self._is_temporary_user(self._key(session_id)):
            return []
        user_record = self._ensure_user(self._key(session_id))
        user_record["memories"] = [item for item in user_record["memories"] if str(item.get("id")) != memory_id]
        self._save()
        token = self._session_tokens.get(session_id)
        if token:
            try:
                await supabase_memory_service.delete_memory(token, memory_id)
            except Exception as exc:
                print(f"Supabase delete fallback: {exc}")
        return await self.memories(session_id)

    def _key(self, session_id: str) -> str:
        return self._session_users.get(session_id) or f"session:{session_id}"

    def _normalize_user_id(self, user_id: str | None) -> str:
        clean = (user_id or "").strip()
        if not clean:
            return "guest-local"
        safe = "".join(ch for ch in clean if ch.isalnum() or ch in ("-", "_", ".", "@"))
        return safe[:80] or "guest-local"

    def _is_temporary_user(self, user_id: str) -> bool:
        return (
            user_id.startswith("session:")
            or user_id == "guest-local"
            or user_id.startswith("demo-guest-")
        )

    def _ensure_user(self, user_id: str) -> dict[str, Any]:
        if user_id not in self._users:
            self._users[user_id] = {"messages": [], "signals": [], "memories": []}
        record = self._users[user_id]
        record.setdefault("messages", [])
        record.setdefault("signals", [])
        record.setdefault("memories", [])
        return record

    def _looks_temporary(self, value: str) -> bool:
        return any(
            marker in value
            for marker in ("不知道", "不确定", "随便", "可能", "也许", "今天很", "现在很", "刚才")
        )

    async def _load_cloud_memories(self, session_id: str) -> None:
        token = self._session_tokens.get(session_id)
        if not token:
            return
        items = await supabase_memory_service.list_memories(token)
        user_record = self._ensure_user(self._key(session_id))
        user_record["memories"] = [
            {
                "id": str(item.get("id") or ""),
                "text": str(item.get("text") or ""),
                "category": item.get("category"),
                "source": item.get("source", "manual"),
                "createdAt": str(item.get("created_at") or ""),
                "updatedAt": str(item.get("updated_at") or ""),
            }
            for item in items
            if item.get("id") and item.get("text")
        ]
        self._save()

    async def _sync_memory(self, session_id: str, memory: dict[str, Any]) -> None:
        token = self._session_tokens.get(session_id)
        if not token:
            return
        try:
            await supabase_memory_service.upsert_memory(token, self._key(session_id), memory)
        except Exception as exc:
            print(f"Supabase memory fallback: {exc}")

    def _load(self) -> None:
        try:
            if not self._data_path.exists():
                return
            data = json.loads(self._data_path.read_text(encoding="utf-8"))
            users = data.get("users") if isinstance(data, dict) else None
            if isinstance(users, dict):
                self._users = {
                    str(user_id): record
                    for user_id, record in users.items()
                    if not self._is_temporary_user(str(user_id))
                }
        except Exception:
            self._users = {}

    def _save(self) -> None:
        try:
            self._data_path.parent.mkdir(parents=True, exist_ok=True)
            self._data_path.write_text(
                json.dumps({"users": self._users}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        except Exception as exc:
            print(f"Memory persistence failed: {exc}")

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()


session_store = SessionStore()

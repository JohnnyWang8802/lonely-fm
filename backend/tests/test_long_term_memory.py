from __future__ import annotations

import asyncio
import tempfile
import unittest
from pathlib import Path

from models.session import SessionStore


class LongTermMemoryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.store = SessionStore()
        self.temp_dir = tempfile.TemporaryDirectory()
        self.store._data_path = Path(self.temp_dir.name) / "memory.json"
        self.store._users = {}
        self.store.bind_user("session-a", "same-user")
        self.store.bind_user("session-b", "same-user")

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_explicit_facts_persist_across_sessions(self) -> None:
        asyncio.run(self.store.remember_from_user("session-a", "我叫王强，我喜欢爵士乐"))
        memories = asyncio.run(self.store.memories("session-b"))
        texts = {item["text"] for item in memories}
        self.assertIn("用户叫王强", texts)
        self.assertIn("用户喜欢爵士乐", texts)

    def test_same_category_is_updated(self) -> None:
        asyncio.run(self.store.remember_from_user("session-a", "我住在杭州"))
        asyncio.run(self.store.remember_from_user("session-b", "我现在住在上海"))
        memories = asyncio.run(self.store.memories("session-a"))
        location_memories = [item for item in memories if "住在" in item["text"]]
        self.assertEqual([item["text"] for item in location_memories], ["用户住在上海"])

    def test_temporary_feeling_is_not_saved(self) -> None:
        asyncio.run(self.store.remember_from_user("session-a", "我现在很累"))
        memories = asyncio.run(self.store.memories("session-a"))
        self.assertEqual(memories, [])

    def test_guest_memory_is_session_only_and_not_saved(self) -> None:
        guest_store = SessionStore()
        guest_store._data_path = Path(self.temp_dir.name) / "guest-memory.json"
        guest_store._users = {}
        guest_store.bind_user("guest-session", "demo-guest-test")

        asyncio.run(guest_store.append("guest-session", "user", "我叫访客"))
        asyncio.run(guest_store.remember_from_user("guest-session", "我叫访客"))

        self.assertEqual(asyncio.run(guest_store.memories("guest-session")), [])
        self.assertFalse(guest_store._data_path.exists())
        self.assertEqual(
            asyncio.run(guest_store.history("guest-session")),
            [{"role": "user", "content": "我叫访客"}],
        )


if __name__ == "__main__":
    unittest.main()

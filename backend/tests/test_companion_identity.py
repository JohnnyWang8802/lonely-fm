from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from prompt.persona import build_prompt
from routers.ws import answer_companion_intent, build_session_greeting, normalize_companion_address


class CompanionIdentityTests(unittest.TestCase):
    def test_session_greeting_is_conversational(self) -> None:
        greeting = build_session_greeting("林屿")
        self.assertEqual(greeting, "嗨，我在呢。今天过得怎么样？")
        self.assertNotIn("接通", greeting)

    def test_linyu_recognizes_exact_name_and_stt_variants(self) -> None:
        for heard_name in ("林屿", "林雨", "淋雨", "林语", "林玉"):
            normalized, addressed = normalize_companion_address(heard_name, "林屿")
            self.assertTrue(addressed)
            self.assertEqual(normalized, "林屿")
            self.assertEqual(answer_companion_intent(normalized, [], "林屿"), "在呢，怎么了？")

    def test_linyu_recognizes_name_at_start_of_a_turn(self) -> None:
        normalized, addressed = normalize_companion_address("淋雨，我今天有点累", "林屿")
        self.assertTrue(addressed)
        self.assertEqual(normalized, "林屿，我今天有点累")

    def test_weather_phrase_is_not_treated_as_a_name(self) -> None:
        normalized, addressed = normalize_companion_address("淋雨了，有点冷", "林屿")
        self.assertFalse(addressed)
        self.assertEqual(normalized, "淋雨了，有点冷")

    def test_identity_prompt_forbids_name_confusion(self) -> None:
        prompt = build_prompt(
            {"primary": "calm", "confidence": 0.8, "speech_rate": "normal"},
            [],
            "林屿，我今天有点累",
            companion_name="林屿",
        )
        system = str(prompt["system"])
        self.assertIn('你始终清楚自己就是"林屿"', system)
        self.assertIn('不要反问这个名字是谁', system)


if __name__ == "__main__":
    unittest.main()

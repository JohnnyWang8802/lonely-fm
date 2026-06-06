from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from prompt.persona import build_prompt
from routers.ws import contextual_bridge_text


class VoicePresenceTests(unittest.TestCase):
    def test_bridge_is_contextual_not_generic(self) -> None:
        cases = {
            "老板今天一直否定我，我真的很累": "老板那块最耗你，",
            "为什么语音回复还是这么慢": "你问的是延迟，",
            "我最近一个人住，晚上特别孤独": "那个孤独感，",
            "林屿你还记得我是谁吗": "你问的是记忆，",
        }
        for text, expected in cases.items():
            with self.subTest(text=text):
                self.assertEqual(contextual_bridge_text(text, {"primary": "calm"}), expected)

    def test_prompt_uses_recent_dialogue_as_voice_context(self) -> None:
        prompt = build_prompt(
            {"primary": "calm", "confidence": 0.78, "speech_rate": "normal"},
            [
                {"role": "user", "content": "我刚才说语音回复还是很慢"},
                {"role": "assistant", "content": "慢主要卡在 Gemma 和 TTS 两段。"},
            ],
            "那现在为什么还是不行",
            companion_name="林屿",
        )
        system = str(prompt["system"])
        self.assertIn("最近对话重点", system)
        self.assertIn("用户:我刚才说语音回复还是很慢", system)
        self.assertIn("结合最近对话重点回答", system)

    def test_prompt_keeps_specificity_rules(self) -> None:
        prompt = build_prompt(
            {"primary": "sadness", "confidence": 0.8, "speech_rate": "slow"},
            [],
            "我今天被老板否定了",
            companion_name="阿婉",
        )
        system = str(prompt["system"])
        self.assertIn("第一句必须回应用户最后一句里的具体对象", system)
        self.assertIn("不要为了温柔而变笨", system)
        self.assertIn("不要只说\"我听见了\"\"我接住了\"", system)


if __name__ == "__main__":
    unittest.main()

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from routers.ws import answer_companion_intent


class FastPathRelevanceTests(unittest.TestCase):
    def test_contextual_turns_reach_gemma(self) -> None:
        turns = (
            "我今天工作很累，但真正让我烦的是同事拿走了我的方案。",
            "我一个人住，不过现在想问你明天上海天气怎么样。",
            "我不知道该怎么办，蓝色雨伞还落在会议室。",
            "我和朋友吵架了，但我想先确认是不是我说错了什么。",
            "最近觉得自己很失败，因为面试一直没有消息。",
            "你是不是觉得我想太多了？",
        )
        for turn in turns:
            with self.subTest(turn=turn):
                self.assertIsNone(answer_companion_intent(turn, [], "林屿"))

    def test_deterministic_social_turns_stay_fast(self) -> None:
        self.assertEqual(answer_companion_intent("你好", [], "林屿"), "你好呀。")
        self.assertEqual(answer_companion_intent("林屿，在吗", [], "林屿"), "在呢，怎么了？")


if __name__ == "__main__":
    unittest.main()

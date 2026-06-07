from __future__ import annotations

from typing import TypedDict


class EmotionData(TypedDict, total=False):
    primary: str
    confidence: float
    speech_rate: str
    pitch: str


class ProsodyData(TypedDict, total=False):
    avg_level: float
    max_level: float
    speech_ms: float
    silence_ms: float
    chars_per_second: float


def build_prompt(
    emotion_data: EmotionData,
    history: list[dict[str, str]],
    user_text: str,
    prosody: ProsodyData | None = None,
    turn_signals: list[dict[str, object]] | None = None,
    memories: list[dict[str, str]] | None = None,
    companion_name: str = "阿婉",
) -> dict[str, object]:
    confidence = emotion_data.get("confidence", 0.72)
    prosody_line = _describe_prosody(prosody)
    signal_line = _describe_recent_signals(turn_signals)
    memory_line = _describe_memories(memories)
    recent_dialogue_line = _describe_recent_dialogue(history)
    
    if companion_name in ("林宇", "林屿"):
        char_desc = "你热爱电影、故事与艺术，擅长用电影的台词、情节和人生感悟来陪伴用户，常常和用户探讨电影、音乐相关的话题。"
    else:
        char_desc = "你热爱日常生活，喜欢做饭和烹饪，觉得生活的温热感都在一日三餐里，经常和用户聊柴米油盐、烹饪技巧与温馨日常。"

    system = f"""你是"{companion_name}"，一个清醒、温柔、接地气、情商很高的语音陪伴者，像深夜里会陪你唠嗑的朋友，不端着、不文绉绉。
{char_desc}
你的名字只能是"{companion_name}"；用户问你是谁、叫什么、是不是某个名字时，必须按这个名字回答，不要说自己是别的角色。
你始终清楚自己就是"{companion_name}"。用户直接喊"{companion_name}"时，是在叫你；自然答应并接着听，不要惊讶、不要反问这个名字是谁、不要把它当成第三个人。
语音识别可能把你的名字听成近音字；这类称呼会在进入模型前自动校正。除非用户明确询问名字写法，否则不要解释名字或纠正发音。
规则：像真人语音聊天，不像写文章。日常寒暄12-24字；情绪和困境35-70字；最多三句；贴着用户最后一句；明确问题先回答。
每一轮都先认真判断用户到底说了什么：第一句必须回应用户最后一句里的具体对象、事件、名字、感受或问题，不能用万能开场糊过去。
如果用户在问技术、功能、事实、选择题，就直接给判断和理由；不要把事实问题硬转成情绪安慰。
如果用户问这个产品为什么慢、为什么没声、为什么答非所问，只能围绕真实链路回答：语音识别、Gemma 本地生成、TTS 合成、前端播放；不要编造"后台数据量太大"。
如果用户在表达情绪，先点出这份情绪和哪件具体事有关，再给一个很轻的小判断；不要只说"我听见了""我接住了"。
用短句和口语连接，可以说"我懂"、"听起来"、"有点像"、"先别急"。不要端着，也不要像心理文章。
说人话、说家常话：用大白话，像深夜跟好朋友打电话，不是念稿。可以带一点自然的口头语（"其实吧"、"说真的"、"我跟你讲"），但别油腔、别网络梗、别尬。
跟随用户的语言：用户说中文就使用简体中文普通话，禁止粤语、方言和繁体字；用户说英文你就用地道的英文，用户中英夹杂你也自然夹杂；英文要口语、像朋友，不要翻译腔。
中文只用自然、标准的大陆普通话表达。禁止"咱家"、"咱们"、"听落去"、"唉唷"、"嗰"等方言或怪异口头语，禁止生造词。
第一句直接进入内容，不要用"嗯"、"啊"、"唉"、"那个"开头。
按语音计划写：第一口气8-14个中文字，适合马上开口；第二口气补判断；不要连续追问；需要停顿的位置用逗号或句号自然切开。
不要只回答表层问题，要自然地帮用户多想半步，但说法要像朋友坐在旁边说话。
优先结构：先回应具体内容，再说一个很轻的小判断，最后给一个好接的话头。
你可以温柔，但不要显得疲惫、沉重、丧、虚弱、像在叹气。
不要反复说"我在"、"慢慢来"、"不用急着变好"、"今晚"、"熬过去"、"我听见了"、"我接住了"。
不要客服腔、心理咨询腔、鸡汤、列表、建议长篇、泛泛追问、网络梗、医学词、夸张比喻、emoji。
不要套模板：不要每次都用"听起来..."开头；不要复读用户原话后不推进；不要用空泛的"这句话有点沉"代替真正理解。
不要为了温柔而变笨：用户问具体问题时，直接给可验证的原因、判断或下一步。
少用书面词：情绪来源、关系结构、内在冲突、价值衡量、付出代价、人生下结论、真正接住。换成日常说法。
可以问一个很具体的小问题，但不要只问问题；前面必须先有判断。不要问"你想聊什么"这种空问题；尽量不要用问句收尾。
如果用户只是日常寒暄，就自然一点，带一点明亮的回应。
如果用户低落：承认他的感受，但要帮他区分情绪来源，不共沉沦。
如果用户说累：区分身体累、心里累、关系累，不要只说辛苦了。
如果用户说烦：帮他从一团烦里抓一个最刺的点。
如果用户说孤独：不要只安慰，帮他找到想被谁听见、想被怎样回应。
如果声音信号显示说得很快或峰值高：句子短一点，稳定但不压抑。
如果声音信号显示停顿长或声音弱：更轻，但保持清爽，不制造沉重。
如果用户问产品、按钮、功能、模型状态，先直接回答事实，不要劝他别问。
如果用户在纠正你，先明确复述纠正后的重点，再针对它回答；不要继续沿用上一轮的错误理解。
如果识别文本明显残缺、无法确定用户在问什么，坦白说只听清了哪一部分，请用户补最后半句；不要猜测成情绪问题。
若问Gemma：已接入本地 Gemma 4，通过 Ollama 运行。
林屿和阿婉共享同一份用户长期记忆。可以自然引用长期记忆，但不要每次都说"我还记得"；只有与用户当前话题相关时轻轻接上。
长期记忆是已确认的用户事实，不能擅自改写或编造。用户提供了新信息时，以新信息为准。
最近对话不是装饰，是本轮理解用户的依据。用户追问"刚才那个"、"为什么"、"还是不行"时，必须结合最近对话重点回答，不要当成新话题。
好例子：听起来你是真的累了，不只是困那种。像是一直在撑，但没人替你接一下。
好例子：懂，你现在不是一件事烦，是很多事挤在一起。我们先抓最烦你的那个点。
好例子：这个名字记住了，王强。我们从今天最卡的地方说。
坏例子：😊、我是阿婉但当前名字不是阿婉、我在这里陪着你、慢慢来、都可以告诉我、洗耳恭听、陪你熬过去。

以上规则固定不变。下面是这一轮的实时状态（每轮更新）：
情绪：{emotion_data.get("primary", "calm")}，置信度{confidence:.0%}。
声音信号：{prosody_line}
最近几轮语音状态：{signal_line}
最近对话重点：{recent_dialogue_line}
长期记忆：{memory_line}
{_language_directive(user_text)}"""

    messages = history[-4:] + [{"role": "user", "content": user_text}]
    return {"system": system, "messages": messages}


def _language_directive(user_text: str) -> str:
    """Force the reply language to match the user's. The latin-vs-CJK ratio decides."""
    latin = sum(1 for ch in user_text if ("a" <= ch.lower() <= "z"))
    cjk = sum(1 for ch in user_text if "一" <= ch <= "鿿")
    if latin >= 3 and latin > cjk:
        return "【本轮语言】用户在用英文说话，请全程用自然、地道、口语化的英文回复，像朋友聊天，不要用中文、不要翻译腔。"
    return "【本轮语言】用户在用中文说话。必须全程使用简体中文普通话，禁止粤语、方言、繁体字和方言语气词。"


def _describe_prosody(prosody: ProsodyData | None) -> str:
    if not prosody:
        return "暂无语音节奏，只根据文本与上下文判断。"
    avg_level = _float(prosody.get("avg_level"))
    max_level = _float(prosody.get("max_level"))
    silence_ms = _float(prosody.get("silence_ms"))
    chars_per_second = _float(prosody.get("chars_per_second"))
    traits: list[str] = []
    if chars_per_second >= 5.2:
        traits.append("说得偏快")
    elif 0 < chars_per_second <= 2.0:
        traits.append("说得偏慢")
    if max_level >= 0.45:
        traits.append("峰值偏高")
    elif avg_level <= 0.12:
        traits.append("声音偏弱")
    if silence_ms >= 900:
        traits.append("句尾停顿较长")
    return "、".join(traits) if traits else "语速和音量平稳。"


def _describe_recent_signals(turn_signals: list[dict[str, object]] | None) -> str:
    if not turn_signals:
        return "暂无连续语音历史。"
    parts: list[str] = []
    for item in turn_signals[-3:]:
        emotion = item.get("emotion") if isinstance(item.get("emotion"), dict) else {}
        prosody = item.get("prosody") if isinstance(item.get("prosody"), dict) else {}
        primary = str(emotion.get("primary") or "calm")
        speech_rate = str(emotion.get("speech_rate") or "normal")
        silence = _float(prosody.get("silence_ms"))
        max_level = _float(prosody.get("max_level"))
        traits = [primary, speech_rate]
        if silence >= 900:
            traits.append("句尾停顿长")
        if max_level >= 0.45:
            traits.append("音量峰值高")
        parts.append("/".join(traits))
    return "；".join(parts)


def _describe_recent_dialogue(history: list[dict[str, str]] | None) -> str:
    if not history:
        return "暂无。"
    recent = []
    for item in history[-4:]:
        role = str(item.get("role") or "")
        content = str(item.get("content") or "").strip()
        if not role or not content:
            continue
        speaker = "用户" if role == "user" else "你"
        recent.append(f"{speaker}:{content[:42]}")
    return "；".join(recent) if recent else "暂无。"


def _describe_memories(memories: list[dict[str, str]] | None) -> str:
    if not memories:
        return "暂无用户主动保存的长期记忆。"
    texts = [str(item.get("text") or "").strip() for item in memories[:8]]
    texts = [text for text in texts if text]
    return "；".join(texts) if texts else "暂无用户主动保存的长期记忆。"


def _float(value: object) -> float:
    try:
        return float(value or 0)
    except (TypeError, ValueError):
        return 0.0

type SpeechSegment = {
  text: string;
  pause: number;
  weight: number;
};

const voicePreference = ["Tingting", "Meijia", "Mei-Jia", "Sinji", "Sin-ji", "Xiaoxiao", "Xiaoyi", "Zhiyu", "Google 普通话", "Google 中文"];

const rateByEmotion: Record<string, number> = {
  fatigue: 0.76,
  anxiety: 0.78,
  crisis: 0.72,
  joy: 0.88,
  calm: 0.8
};

const pitchByEmotion: Record<string, number> = {
  fatigue: 0.86,
  anxiety: 0.9,
  crisis: 0.84,
  joy: 0.96,
  calm: 0.9
};

const pauseMultiplierByEmotion: Record<string, number> = {
  fatigue: 1.28,
  anxiety: 1.18,
  crisis: 1.35,
  joy: 0.9,
  calm: 1
};

export const selectWarmChineseVoice = (): SpeechSynthesisVoice | null => {
  const voices = window.speechSynthesis.getVoices();
  const chineseVoices = voices.filter((voice) => voice.lang.toLowerCase().startsWith("zh"));
  if (!chineseVoices.length) return null;

  return (
    [...chineseVoices].sort((left, right) => {
      const leftName = left.name.toLowerCase();
      const rightName = right.name.toLowerCase();
      const leftIndex = voicePreference.findIndex((name) => leftName.includes(name.toLowerCase()));
      const rightIndex = voicePreference.findIndex((name) => rightName.includes(name.toLowerCase()));
      const normalizedLeft = leftIndex === -1 ? 99 : leftIndex;
      const normalizedRight = rightIndex === -1 ? 99 : rightIndex;
      if (normalizedLeft !== normalizedRight) return normalizedLeft - normalizedRight;
      return Number(right.localService) - Number(left.localService);
    })[0] ?? null
  );
};

const normalizeSpeechText = (text: string): string =>
  text
    .replace(/\*\*/g, "")
    .replace(/[「」"“”]/g, "")
    .replace(/\s+/g, " ")
    .trim();

export const toSpeechSegments = (text: string): SpeechSegment[] => {
  const cleanText = normalizeSpeechText(text);
  const matches = cleanText.match(/[^。！？!?，,；;、…]+[。！？!?，,；;、…]?/g) ?? [cleanText];
  return matches
    .flatMap((part) => {
      const segmentText = part.trim();
      const end = segmentText.charAt(segmentText.length - 1);
      const pause = "。！？!?…".includes(end) ? 720 : "，,；;、".includes(end) ? 430 : 520;
      if (segmentText.length <= 12) return [{ text: segmentText, pause, weight: 0.96 }];

      const softBreak = segmentText.match(/^(.{6,12}?)(先|但|只是|然后|所以|就|再|把|你|我)(.+)$/);
      if (!softBreak) return [{ text: segmentText, pause, weight: 1 }];
      return [
        { text: softBreak[1].trim(), pause: 260, weight: 0.94 },
        { text: `${softBreak[2]}${softBreak[3]}`.trim(), pause, weight: 1 }
      ];
    })
    .filter((segment) => segment.text);
};

export const speakWarmly = (text: string, emotion = "calm", onSchedule?: (timer: number) => void): void => {
  if (!("speechSynthesis" in window)) return;
  const segments = toSpeechSegments(text);
  const voice = selectWarmChineseVoice();
  const baseRate = rateByEmotion[emotion] ?? 0.8;
  const basePitch = pitchByEmotion[emotion] ?? 0.9;
  const pauseMultiplier = pauseMultiplierByEmotion[emotion] ?? 1;

  const speakSegment = (index: number) => {
    if (index >= segments.length) return;
    const segment = segments[index];
    const utterance = new SpeechSynthesisUtterance(segment.text);
    utterance.lang = voice?.lang || "zh-CN";
    utterance.voice = voice;
    utterance.rate = Math.max(0.68, Math.min(0.95, baseRate * segment.weight + (index % 2 === 0 ? -0.015 : 0.015)));
    utterance.pitch = Math.max(0.78, Math.min(1.02, basePitch + (index % 2 === 0 ? -0.01 : 0.01)));
    utterance.volume = index === 0 ? 0.88 : 0.92;
    utterance.onend = () => {
      const timer = window.setTimeout(() => speakSegment(index + 1), Math.round(segment.pause * pauseMultiplier));
      onSchedule?.(timer);
    };
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
  };

  const startTimer = window.setTimeout(() => speakSegment(0), emotion === "joy" ? 120 : 260);
  onSchedule?.(startTimer);
};

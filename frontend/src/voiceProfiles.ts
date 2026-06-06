import type { VoiceProfile } from "./types";

export const VOICE_PROFILES: VoiceProfile[] = [
  {
    id: "linyu",
    displayName: "林屿",
    romanName: "Linyu",
    gender: "male",
    voiceId: "Chinese (Mandarin)_Radio_Host",
    tone: "低沉、稳，像深夜陪你唠嗑的哥们 · 中英双语"
  },
  {
    id: "awan",
    displayName: "阿婉",
    romanName: "Awan",
    gender: "female",
    voiceId: "Chinese (Mandarin)_Warm_Bestie",
    tone: "亲近、温热，像能说心里话的姐妹 · 中英双语"
  }
];

export const DEFAULT_VOICE_PROFILE = VOICE_PROFILES[1];

import { create } from "zustand";
import { supabase } from "../services/supabase";
import type {
  AuthProfile,
  EmotionData,
  GemmaConnection,
  MemoryCard,
  ReplyAudioChunk,
  TranscriptLine,
  VoiceProfile
} from "../types";

interface SessionState {
  sessionId: string;
  authProfile: AuthProfile | null;
  gemmaConnection: GemmaConnection | null;
  selectedVoice: VoiceProfile | null;
  connected: boolean;
  reconnecting: boolean;
  listening: boolean;
  assistantSpeaking: boolean;
  muted: boolean;
  darkMode: boolean;
  emotion: EmotionData;
  currentAiText: string;
  lastReplyAudio: ReplyAudioChunk[];
  lastError: string | null;
  transcript: TranscriptLine[];
  memories: MemoryCard[];
  login: (profile: AuthProfile) => void;
  logout: () => void;
  setGemmaConnection: (connection: GemmaConnection | null) => void;
  setSelectedVoice: (voice: VoiceProfile) => void;
  clearSelectedVoice: () => void;
  setConnected: (connected: boolean) => void;
  setReconnecting: (reconnecting: boolean) => void;
  setListening: (listening: boolean) => void;
  setAssistantSpeaking: (speaking: boolean) => void;
  setMuted: (muted: boolean) => void;
  setDarkMode: (darkMode: boolean) => void;
  setEmotion: (emotion: EmotionData) => void;
  setError: (message: string | null) => void;
  appendUserTranscript: (text: string, isFinal: boolean) => void;
  appendAiText: (text: string, done?: boolean) => void;
  clearAiText: () => void;
  clearReplyAudio: () => void;
  appendReplyAudio: (chunk: ReplyAudioChunk) => void;
  addMemory: (text: string) => void;
  setMemories: (memories: MemoryCard[]) => void;
  deleteMemory: (id: string) => void;
}

const createSessionId = (): string => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
};

const readStoredAuthProfile = (): AuthProfile | null => {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem("lonelyfm.auth");
    if (!value) return null;
    const profile = JSON.parse(value) as AuthProfile;
    return profile.provider === "guest" ? null : profile;
  } catch {
    return null;
  }
};

const persistAuthProfile = (profile: AuthProfile | null): void => {
  if (typeof window === "undefined") return;
  if (profile && profile.provider !== "guest") {
    window.localStorage.setItem("lonelyfm.auth", JSON.stringify(profile));
  } else {
    window.localStorage.removeItem("lonelyfm.auth");
  }
};

const readStoredGemmaConnection = (): GemmaConnection | null => {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem("lonelyfm.gemma.connection");
    if (!value) return null;
    const connection = JSON.parse(value) as GemmaConnection;
    return connection.ready ? connection : null;
  } catch {
    return null;
  }
};

const persistGemmaConnection = (connection: GemmaConnection | null): void => {
  if (typeof window === "undefined") return;
  if (connection?.ready) {
    window.localStorage.setItem("lonelyfm.gemma.connection", JSON.stringify(connection));
  } else {
    window.localStorage.removeItem("lonelyfm.gemma.connection");
  }
};

export const useSessionStore = create<SessionState>((set) => ({
  sessionId: createSessionId(),
  authProfile: readStoredAuthProfile(),
  gemmaConnection: readStoredGemmaConnection(),
  selectedVoice: null,
  connected: false,
  reconnecting: false,
  listening: false,
  assistantSpeaking: false,
  muted: false,
  darkMode: false,
  emotion: { primary: "calm", confidence: 0.72, speech_rate: "normal", pitch: "normal" },
  currentAiText: "",
  lastReplyAudio: [],
  lastError: null,
  transcript: [
    {
      id: "welcome",
      speaker: "awan",
      text: "我听着。你从最想说的那句开始。",
      isFinal: true
    }
  ],
  memories: [],
  login: (authProfile) => {
    persistAuthProfile(authProfile);
    set({
      authProfile,
      currentAiText: "",
      lastReplyAudio: [],
      lastError: null
    });
  },
  logout: () => {
    void supabase?.auth.signOut();
    persistAuthProfile(null);
    set({
      authProfile: null,
      gemmaConnection: null,
      selectedVoice: null,
      currentAiText: "",
      lastReplyAudio: [],
      connected: false,
      reconnecting: false,
      listening: false,
      assistantSpeaking: false,
      memories: [],
      transcript: [
        {
          id: "welcome",
          speaker: "awan",
          text: "我听着。你从最想说的那句开始。",
          isFinal: true
        }
      ],
      lastError: null
    });
    persistGemmaConnection(null);
  },
  setGemmaConnection: (gemmaConnection) => {
    persistGemmaConnection(gemmaConnection);
    set({ gemmaConnection });
  },
  setSelectedVoice: (selectedVoice) =>
    set({
      selectedVoice,
      currentAiText: "",
      lastReplyAudio: [],
      transcript: [
        {
          id: "welcome",
          speaker: "awan",
          text: `${selectedVoice.displayName}听着。你从最想说的那句开始。`,
          isFinal: true
        }
      ]
    }),
  clearSelectedVoice: () =>
    set({
      selectedVoice: null,
      currentAiText: "",
      lastReplyAudio: [],
      connected: false,
      reconnecting: false,
      listening: false,
      assistantSpeaking: false
    }),
  setConnected: (connected) => set({ connected }),
  setReconnecting: (reconnecting) => set({ reconnecting }),
  setListening: (listening) => set({ listening }),
  setAssistantSpeaking: (assistantSpeaking) => set({ assistantSpeaking }),
  setMuted: (muted) => set({ muted }),
  setDarkMode: (darkMode) => set({ darkMode }),
  setEmotion: (emotion) => set({ emotion }),
  setError: (message) => set({ lastError: message }),
  appendUserTranscript: (text, isFinal) =>
    set((state) => {
      const lines = state.transcript.filter((line) => line.id !== "interim-user");
      const normalizedText = text.trim();
      const lastLine = lines[lines.length - 1];
      if (
        isFinal &&
        lastLine?.speaker === "user" &&
        lastLine.isFinal &&
        lastLine.text.trim() === normalizedText
      ) {
        return { transcript: lines };
      }
      const id = isFinal ? `u-${Date.now()}` : "interim-user";
      return {
        transcript: [...lines, { id, speaker: "user", text: normalizedText || text, isFinal }]
      };
    }),
  appendAiText: (text, done) =>
    set((state) => {
      const nextText = done ? text : `${state.currentAiText}${text}`;
      const lines = state.transcript.filter((line) => line.id !== "stream-ai");
      return {
        currentAiText: done ? "" : nextText,
        transcript: [...lines, { id: done ? `a-${Date.now()}` : "stream-ai", speaker: "awan", text: nextText, isFinal: Boolean(done) }]
      };
    }),
  clearAiText: () => set({ currentAiText: "" }),
  clearReplyAudio: () => set({ lastReplyAudio: [] }),
  appendReplyAudio: (chunk) =>
    set((state) => ({
      lastReplyAudio: [...state.lastReplyAudio, chunk].slice(-240)
    })),
  addMemory: (text) =>
    set((state) => {
      const normalizedText = text.trim();
      if (!normalizedText || state.memories.some((memory) => memory.text === normalizedText)) {
        return { memories: state.memories };
      }
      return {
        memories: [
          { id: `m-${Date.now()}`, text: normalizedText, createdAt: new Date().toISOString() },
          ...state.memories
        ].slice(0, 6)
      };
    }),
  setMemories: (memories) => set({ memories: memories.slice(0, 12) }),
  deleteMemory: (id) =>
    set((state) => ({
      memories: state.memories.filter((memory) => memory.id !== id)
    }))
}));

export type EmotionPrimary = "calm" | "sadness" | "fatigue" | "joy" | "anxiety" | "crisis";

export interface EmotionData {
  primary: EmotionPrimary;
  confidence: number;
  speech_rate: "slow" | "normal" | "fast";
  pitch?: "low" | "normal" | "high";
}

export interface TranscriptData {
  text: string;
  is_final: boolean;
}

export interface AiTextChunkData {
  text: string;
  done?: boolean;
  speak?: boolean;
}

export interface AudioChunkData {
  data: string;
  mime_type?: string;
}

export interface ReplyAudioChunk {
  data: string;
  mimeType: string;
}

export interface AuthProfile {
  id: string;
  name: string;
  email?: string;
  provider: "email" | "guest";
  signedInAt: string;
  accessToken?: string;
}

export type GemmaConnectionMode = "local" | "cloud";

export interface GemmaConnection {
  mode: GemmaConnectionMode;
  ready: boolean;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  checkedAt: string;
}

export type VoiceProfileId = "linyu" | "awan";

export interface VoiceProfile {
  id: VoiceProfileId;
  displayName: string;
  romanName: string;
  gender: "male" | "female";
  voiceId: string;
  tone: string;
}

export interface ProsodyMetrics {
  avg_level: number;
  max_level: number;
  speech_ms: number;
  silence_ms: number;
  chars_per_second: number;
}

export interface ServerErrorMessage {
  type: "error";
  message: string;
}

export type ServerMessage =
  | { type: "emotion"; data: EmotionData }
  | { type: "transcript"; data: TranscriptData }
  | { type: "ai_text_chunk"; data: AiTextChunkData }
  | { type: "audio_chunk"; data: AudioChunkData }
  | { type: "audio_cue"; data: AudioChunkData }
  | { type: "memory_sync"; data: { memories: MemoryCard[] } }
  | { type: "session_ready"; data: { greeted: boolean } }
  | { type: "turn_cancelled" }
  | ServerErrorMessage;

export interface ClientMessageBase {
  session_id: string;
  user_id?: string;
  access_token?: string;
  voice_id?: string;
  voice_profile_id?: VoiceProfileId;
  gemma_mode?: GemmaConnectionMode;
  gemma_model?: string;
  gemma_base_url?: string;
  gemma_api_key?: string;
}

export type ClientMessage =
  | (ClientMessageBase & { type: "session_start" })
  | (ClientMessageBase & { type: "session_greeting" })
  | (ClientMessageBase & { type: "session_end" })
  | (ClientMessageBase & { type: "barge_in" })
  | (ClientMessageBase & { type: "memory_save"; text: string })
  | (ClientMessageBase & { type: "memory_delete"; memory_id: string })
  | (ClientMessageBase & { type: "audio_chunk"; data: string; mime_type?: string })
  | (ClientMessageBase & { type: "text_input"; text: string; prosody?: ProsodyMetrics });

export type ClientOutboundMessage = ClientMessage extends infer Message
  ? Message extends ClientMessageBase
    ? Omit<Message, "session_id">
    : never
  : never;

export interface MemoryCard {
  id: string;
  text: string;
  createdAt: string;
}

export interface GemmaStatus {
  provider: string;
  local_provider?: string;
  base_url?: string;
  model: string;
  available: boolean;
  models?: string[];
  error?: string;
}

export interface SystemStatus {
  ok: boolean;
  gemma_provider: string;
  local_gemma_provider: string;
  hume_configured: boolean;
  tts_provider: string;
  minimax_configured: boolean;
  google_tts_configured: boolean;
  emotion_stack: string;
  voice_stack: string;
  sesame_jump_ready: boolean;
}

export interface TranscriptLine {
  id: string;
  speaker: "user" | "awan";
  text: string;
  isFinal: boolean;
}

export interface SpeechRecognitionAlternative {
  transcript: string;
  confidence: number;
}

export interface SpeechRecognitionResult {
  readonly isFinal: boolean;
  readonly length: number;
  item(index: number): SpeechRecognitionAlternative;
  [index: number]: SpeechRecognitionAlternative;
}

export interface SpeechRecognitionResultList {
  readonly length: number;
  item(index: number): SpeechRecognitionResult;
  [index: number]: SpeechRecognitionResult;
}

export interface SpeechRecognitionEvent extends Event {
  readonly resultIndex: number;
  readonly results: SpeechRecognitionResultList;
}

export interface SpeechRecognitionErrorEvent extends Event {
  readonly error: string;
}

export interface SpeechRecognition extends EventTarget {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
}

export interface SpeechRecognitionConstructor {
  new (): SpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

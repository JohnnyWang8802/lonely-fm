import { useCallback, useEffect, useRef, useState } from "react";
import { useSessionStore } from "../store/sessionStore";
import type { ClientOutboundMessage, SpeechRecognitionEvent } from "../types";

interface UseAudioRecorderArgs {
  send: (message: ClientOutboundMessage) => void;
}

interface UseAudioRecorderResult {
  startRecording: () => Promise<void>;
  stopRecording: () => void;
  level: number;
  transcriptSupported: boolean;
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Audio encoding failed"));
        return;
      }
      resolve(result.split(",")[1] ?? "");
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

const CHECK_TURN_INTERVAL_MS = 60;
const MIN_TURN_SILENCE_MS = 900;
const CONTINUATION_TURN_SILENCE_MS = 1400;
const MIN_PENDING_AGE_MS = 360;
const MAX_PENDING_AGE_MS = 3600;
const MIN_TRANSCRIPT_STABLE_MS = 780;
const VOICE_ACTIVITY_THRESHOLD = 0.075;
const RECOGNITION_RESTART_DELAY_MS = 160;
const RECOGNITION_WATCHDOG_MS = 1800;
const RECOGNITION_STALE_MS = 9000;
const RECOGNITION_MAX_SESSION_MS = 12000;
const CONTINUATION_ENDINGS = [
  "然后", "但是", "可是", "因为", "就是", "还有", "那个", "嗯", "呃", "我觉得", "我想",
  "我问", "问你", "你知道", "这个", "那个是", "是不是", "能不能", "可不可以"
];

const needsMoreTurnTime = (text: string): boolean => {
  const normalized = text.trim();
  if (!normalized) return false;
  if (/[。！？!?]$/.test(normalized)) return false;
  return CONTINUATION_ENDINGS.some((ending) => normalized.endsWith(ending));
};

export const useAudioRecorder = ({ send }: UseAudioRecorderArgs): UseAudioRecorderResult => {
  const mountedRef = useRef(true);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recognitionRef = useRef<import("../types").SpeechRecognition | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const flushTimerRef = useRef<number | null>(null);
  const recognitionRestartTimerRef = useRef<number | null>(null);
  const recognitionWatchdogRef = useRef<number | null>(null);
  const startingRef = useRef(false);
  const manuallyStoppingRef = useRef(false);
  const assistantSpeakingRef = useRef(false);
  const recognitionStartingRef = useRef(false);
  const lastRecognitionEventAtRef = useRef(0);
  const recognitionStartedAtRef = useRef(0);
  const lastVoiceAtRef = useRef(0);
  const pendingQueuedAtRef = useRef(0);
  const turnStartedAtRef = useRef(0);
  const levelSumRef = useRef(0);
  const levelSamplesRef = useRef(0);
  const maxLevelRef = useRef(0);
  const finalTranscriptRef = useRef("");
  const pendingTranscriptRef = useRef("");
  const interimTranscriptRef = useRef("");
  const interimQueuedAtRef = useRef(0);
  const lastSentTextRef = useRef("");
  const lastSentAtRef = useRef(0);
  const recognitionSupportedRef = useRef(Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition));
  const [level, setLevel] = useState(0);
  const setListening = useSessionStore((state) => state.setListening);
  const setError = useSessionStore((state) => state.setError);
  const appendUserTranscript = useSessionStore((state) => state.appendUserTranscript);

  const stopLevelMeter = useCallback(() => {
    if (animationFrameRef.current) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setLevel(0);
  }, []);

  const clearRecognitionRestart = useCallback(() => {
    if (recognitionRestartTimerRef.current) {
      window.clearTimeout(recognitionRestartTimerRef.current);
      recognitionRestartTimerRef.current = null;
    }
  }, []);

  const clearRecognitionWatchdog = useCallback(() => {
    if (recognitionWatchdogRef.current) {
      window.clearInterval(recognitionWatchdogRef.current);
      recognitionWatchdogRef.current = null;
    }
  }, []);

  const startLevelMeter = useCallback(() => {
    const analyser = analyserRef.current;
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      const peak = data.reduce((max, value) => Math.max(max, Math.abs(value - 128)), 0);
      const normalizedLevel = Math.min(1, peak / 48);
      levelSumRef.current += normalizedLevel;
      levelSamplesRef.current += 1;
      maxLevelRef.current = Math.max(maxLevelRef.current, normalizedLevel);
      if (normalizedLevel > VOICE_ACTIVITY_THRESHOLD) {
        lastVoiceAtRef.current = Date.now();
      }
      setLevel(normalizedLevel);
      animationFrameRef.current = window.requestAnimationFrame(tick);
    };
    tick();
  }, []);

  const recycleRecognition = useCallback((delay = RECOGNITION_RESTART_DELAY_MS) => {
    if (manuallyStoppingRef.current || assistantSpeakingRef.current || !streamRef.current) return;
    clearRecognitionRestart();
    try {
      recognitionRef.current?.abort();
    } catch {
      // Chrome can throw when Web Speech is already stopping.
    }
    recognitionRef.current = null;
    recognitionStartingRef.current = false;
    recognitionRestartTimerRef.current = window.setTimeout(() => {
      if (!manuallyStoppingRef.current && !assistantSpeakingRef.current && streamRef.current) {
        startRecognition();
      }
    }, delay);
  }, [clearRecognitionRestart]);

  const normalizeTranscript = useCallback((text: string) => text.replace(/[。！？!?，,、\s]/g, "").trim(), []);

  const shouldSkipDuplicateText = useCallback(
    (text: string) => {
      const normalizedText = normalizeTranscript(text);
      const normalizedLast = normalizeTranscript(lastSentTextRef.current);
      if (!normalizedText || !normalizedLast) return false;
      if (Date.now() - lastSentAtRef.current > 2500) return false;
      return normalizedText === normalizedLast || normalizedText.includes(normalizedLast) || normalizedLast.includes(normalizedText);
    },
    [normalizeTranscript]
  );

  const flushPendingTranscript = useCallback((overrideText?: string) => {
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    const text = (overrideText ?? (pendingTranscriptRef.current || interimTranscriptRef.current)).trim();
    const now = Date.now();
    const queuedAt = pendingQueuedAtRef.current || interimQueuedAtRef.current || now;
    const turnStartedAt = turnStartedAtRef.current || queuedAt;
    const speechMs = Math.max(0, lastVoiceAtRef.current - turnStartedAt);
    const silenceMs = Math.max(0, now - lastVoiceAtRef.current);
    const avgLevel = levelSamplesRef.current > 0 ? levelSumRef.current / levelSamplesRef.current : 0;
    const prosody = {
      avg_level: Number(avgLevel.toFixed(3)),
      max_level: Number(maxLevelRef.current.toFixed(3)),
      speech_ms: Math.round(speechMs),
      silence_ms: Math.round(silenceMs),
      chars_per_second: speechMs > 0 ? Number((text.length / (speechMs / 1000)).toFixed(2)) : 0
    };
    pendingTranscriptRef.current = "";
    interimTranscriptRef.current = "";
    pendingQueuedAtRef.current = 0;
    interimQueuedAtRef.current = 0;
    turnStartedAtRef.current = 0;
    levelSumRef.current = 0;
    levelSamplesRef.current = 0;
    maxLevelRef.current = 0;
    if (text && !shouldSkipDuplicateText(text)) {
      lastSentTextRef.current = text;
      lastSentAtRef.current = now;
      send({ type: "text_input", text, prosody });
      recycleRecognition(120);
    }
  }, [recycleRecognition, send, shouldSkipDuplicateText]);

  const checkTurnEnd = useCallback(() => {
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }

    const pendingText = (pendingTranscriptRef.current || interimTranscriptRef.current).trim();
    if (!pendingText) return;

    const now = Date.now();
    const silenceMs = now - lastVoiceAtRef.current;
    const queuedAt = pendingQueuedAtRef.current || interimQueuedAtRef.current || now;
    const pendingAgeMs = now - queuedAt;
    const transcriptStableMs = now - lastRecognitionEventAtRef.current;
    const requiredSilenceMs = needsMoreTurnTime(pendingText) ? CONTINUATION_TURN_SILENCE_MS : MIN_TURN_SILENCE_MS;
    const shouldReply =
      silenceMs >= requiredSilenceMs &&
      pendingAgeMs >= MIN_PENDING_AGE_MS &&
      transcriptStableMs >= MIN_TRANSCRIPT_STABLE_MS;
    const shouldFallback = pendingAgeMs >= MAX_PENDING_AGE_MS && transcriptStableMs >= MIN_TRANSCRIPT_STABLE_MS;

    if (shouldReply || shouldFallback) {
      flushPendingTranscript();
      return;
    }

    flushTimerRef.current = window.setTimeout(checkTurnEnd, CHECK_TURN_INTERVAL_MS);
  }, [flushPendingTranscript]);

  const queueFinalText = useCallback(
    (text: string) => {
      const cleanText = text.trim();
      if (!cleanText) return;
      if (shouldSkipDuplicateText(cleanText)) {
        interimTranscriptRef.current = "";
        interimQueuedAtRef.current = 0;
        return;
      }
      interimTranscriptRef.current = "";
      interimQueuedAtRef.current = 0;
      pendingTranscriptRef.current = `${pendingTranscriptRef.current}${cleanText}`;
      pendingQueuedAtRef.current = pendingQueuedAtRef.current || Date.now();
      turnStartedAtRef.current = turnStartedAtRef.current || Math.min(lastVoiceAtRef.current || Date.now(), pendingQueuedAtRef.current);
      checkTurnEnd();
    },
    [checkTurnEnd, shouldSkipDuplicateText]
  );

  const scheduleRecognitionRestart = useCallback((delay = RECOGNITION_RESTART_DELAY_MS) => {
    clearRecognitionRestart();
    recognitionRestartTimerRef.current = window.setTimeout(() => {
      if (!manuallyStoppingRef.current && streamRef.current) {
        startRecognition();
      }
    }, delay);
  }, [clearRecognitionRestart]);

  const startRecognition = useCallback(() => {
    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    recognitionSupportedRef.current = Boolean(Recognition);
    if (!Recognition) return;
    if (recognitionStartingRef.current) return;
    clearRecognitionRestart();
    recognitionStartingRef.current = true;
    const recognition = new Recognition();
    recognition.lang = "zh-CN";
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event: SpeechRecognitionEvent) => {
      lastRecognitionEventAtRef.current = Date.now();
      let interim = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const text = result[0]?.transcript.trim() ?? "";
        if (!text) continue;
        if (result.isFinal) {
          finalTranscriptRef.current = `${finalTranscriptRef.current}${text}`;
          appendUserTranscript(text, true);
          queueFinalText(text);
        } else {
          interim = text;
        }
      }
      if (interim) {
        interimTranscriptRef.current = interim;
        interimQueuedAtRef.current = interimQueuedAtRef.current || Date.now();
        turnStartedAtRef.current = turnStartedAtRef.current || Math.min(lastVoiceAtRef.current || Date.now(), interimQueuedAtRef.current);
        appendUserTranscript(interim, false);
        checkTurnEnd();
      }
    };
    recognition.onerror = (event) => {
      lastRecognitionEventAtRef.current = Date.now();
      const recoverableErrors = new Set(["aborted", "network", "no-speech", "service-not-allowed"]);
      const shouldRecoverAfterAudio = assistantSpeakingRef.current;
      if (!shouldRecoverAfterAudio && !recoverableErrors.has(event.error)) {
        setError("语音识别短暂中断，正在恢复。");
      }
      recognitionRef.current = null;
      recognitionStartingRef.current = false;
      if (shouldRecoverAfterAudio) return;
      scheduleRecognitionRestart(420);
    };
    recognition.onend = () => {
      recognitionRef.current = null;
      recognitionStartingRef.current = false;
      if (manuallyStoppingRef.current || assistantSpeakingRef.current || !streamRef.current) return;
      scheduleRecognitionRestart();
    };
    recognitionRef.current = recognition;
    try {
      recognition.start();
      lastRecognitionEventAtRef.current = Date.now();
      recognitionStartedAtRef.current = Date.now();
    } catch {
      recognitionRef.current = null;
      setError("语音识别启动失败，请再点一次麦克风。");
      scheduleRecognitionRestart(600);
    } finally {
      recognitionStartingRef.current = false;
    }
  }, [appendUserTranscript, clearRecognitionRestart, queueFinalText, scheduleRecognitionRestart, setError]);

  const startRecognitionWatchdog = useCallback(() => {
    clearRecognitionWatchdog();
    recognitionWatchdogRef.current = window.setInterval(() => {
      const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      if (!Recognition || manuallyStoppingRef.current || assistantSpeakingRef.current || !streamRef.current) return;
      const now = Date.now();
      const recognitionIsMissing = !recognitionRef.current && !recognitionRestartTimerRef.current;
      const recognitionIsOld =
        Boolean(recognitionRef.current) &&
        recognitionStartedAtRef.current > 0 &&
        now - recognitionStartedAtRef.current > RECOGNITION_MAX_SESSION_MS &&
        !pendingTranscriptRef.current.trim();
      const recognitionIsStale =
        Boolean(recognitionRef.current) &&
        lastRecognitionEventAtRef.current > 0 &&
        now - lastRecognitionEventAtRef.current > RECOGNITION_STALE_MS &&
        !pendingTranscriptRef.current.trim();

      if (recognitionIsMissing || recognitionIsOld || recognitionIsStale) {
        recycleRecognition();
      }
    }, RECOGNITION_WATCHDOG_MS);
  }, [clearRecognitionWatchdog, recycleRecognition]);

  useEffect(() => {
    const pauseRecognitionForAssistant = () => {
      assistantSpeakingRef.current = true;
      clearRecognitionRestart();
      try {
        recognitionRef.current?.stop();
      } catch {
        // Chrome can throw when Web Speech is already stopping.
      }
      recognitionRef.current = null;
      recognitionStartingRef.current = false;
    };

    const resumeRecognitionAfterAssistant = () => {
      if (!assistantSpeakingRef.current) return;
      assistantSpeakingRef.current = false;
      if (!manuallyStoppingRef.current && streamRef.current) {
        scheduleRecognitionRestart(160);
      }
    };

    const resumeForBargeIn = () => {
      assistantSpeakingRef.current = false;
      if (!manuallyStoppingRef.current && streamRef.current) {
        scheduleRecognitionRestart(0);
      }
    };

    window.addEventListener("lonelyfm:assistant-audio-start", pauseRecognitionForAssistant);
    window.addEventListener("lonelyfm:assistant-audio-end", resumeRecognitionAfterAssistant);
    window.addEventListener("lonelyfm:barge-in", resumeForBargeIn);
    return () => {
      window.removeEventListener("lonelyfm:assistant-audio-start", pauseRecognitionForAssistant);
      window.removeEventListener("lonelyfm:assistant-audio-end", resumeRecognitionAfterAssistant);
      window.removeEventListener("lonelyfm:barge-in", resumeForBargeIn);
    };
  }, [clearRecognitionRestart, scheduleRecognitionRestart]);

  const startRecording = useCallback(async () => {
    if (!mountedRef.current || startingRef.current || streamRef.current) return;
    window.dispatchEvent(new CustomEvent("lonelyfm:barge-in"));
    startingRef.current = true;
    try {
      finalTranscriptRef.current = "";
      pendingTranscriptRef.current = "";
      interimTranscriptRef.current = "";
      pendingQueuedAtRef.current = 0;
      interimQueuedAtRef.current = 0;
      lastSentTextRef.current = "";
      lastSentAtRef.current = 0;
      turnStartedAtRef.current = 0;
      levelSumRef.current = 0;
      levelSamplesRef.current = 0;
      maxLevelRef.current = 0;
      lastVoiceAtRef.current = Date.now();
      assistantSpeakingRef.current = false;
      manuallyStoppingRef.current = false;
      clearRecognitionRestart();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mountedRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const audioContext = new AudioContext();
      audioContextRef.current = audioContext;
      const source = audioContext.createMediaStreamSource(stream);
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      analyserRef.current = analyser;
      startLevelMeter();

      const recognitionAvailable = Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition);
      if (!recognitionAvailable) {
        const options = MediaRecorder.isTypeSupported("audio/webm") ? { mimeType: "audio/webm" } : undefined;
        const recorder = new MediaRecorder(stream, options);
        mediaRecorderRef.current = recorder;
        recorder.ondataavailable = async (event) => {
          if (!mountedRef.current) return;
          if (event.data.size === 0) return;
          const data = await blobToBase64(event.data);
          if (!mountedRef.current) return;
          send({ type: "audio_chunk", data, mime_type: event.data.type });
        };
        recorder.start(1200);
      }
      startRecognition();
      startRecognitionWatchdog();
      setListening(true);
      setError(null);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      stopLevelMeter();
      clearRecognitionWatchdog();
      setError("无法访问麦克风，请检查浏览器权限。");
      setListening(false);
    } finally {
      startingRef.current = false;
    }
  }, [clearRecognitionWatchdog, send, setError, setListening, startLevelMeter, startRecognition, startRecognitionWatchdog, stopLevelMeter]);

  const stopRecording = useCallback(() => {
    manuallyStoppingRef.current = true;
    assistantSpeakingRef.current = false;
    clearRecognitionRestart();
    clearRecognitionWatchdog();
    if (flushTimerRef.current) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    recognitionStartingRef.current = false;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void audioContextRef.current?.close();
    audioContextRef.current = null;
    stopLevelMeter();
    startingRef.current = false;
    setListening(false);
    flushPendingTranscript(pendingTranscriptRef.current || interimTranscriptRef.current);

    const finalText = finalTranscriptRef.current.trim();
    if (!finalText && !recognitionSupportedRef.current) {
      send({ type: "text_input", text: "我刚才说了一段话，但浏览器没有识别出来。" });
    }
  }, [clearRecognitionRestart, clearRecognitionWatchdog, flushPendingTranscript, send, setListening, stopLevelMeter]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      manuallyStoppingRef.current = true;
      assistantSpeakingRef.current = false;
      clearRecognitionRestart();
      clearRecognitionWatchdog();
      if (flushTimerRef.current) {
        window.clearTimeout(flushTimerRef.current);
        flushTimerRef.current = null;
      }
      try {
        mediaRecorderRef.current?.stop();
      } catch {
        // MediaRecorder can throw if the browser already stopped it.
      }
      mediaRecorderRef.current = null;
      try {
        recognitionRef.current?.abort();
      } catch {
        // Chrome can throw when Web Speech is already stopped.
      }
      recognitionRef.current = null;
      recognitionStartingRef.current = false;
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
      void audioContextRef.current?.close();
      audioContextRef.current = null;
      stopLevelMeter();
      startingRef.current = false;
      setListening(false);
    };
  }, [clearRecognitionRestart, clearRecognitionWatchdog, setListening, stopLevelMeter]);

  return {
    startRecording,
    stopRecording,
    level,
    transcriptSupported: Boolean(window.SpeechRecognition ?? window.webkitSpeechRecognition)
  };
};

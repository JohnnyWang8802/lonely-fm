import { useCallback, useEffect, useRef } from "react";
import { getWsUrl } from "../services/backend";
import { useSessionStore } from "../store/sessionStore";
import type { ClientMessage, ClientOutboundMessage, ReplyAudioChunk, ServerMessage } from "../types";
import {
  clearAudioPlaybackRetry,
  createAudioUrl,
  createPlaybackAudio,
  createStreamingAudioHandle,
  looksLikePlayableAudio,
  queueAudioPlaybackRetry,
  type StreamingAudioHandle
} from "../utils/audio";

const dispatchAssistantAudioState = (state: "start" | "end") => {
  window.dispatchEvent(new CustomEvent(`lonelyfm:assistant-audio-${state}`));
};

const stopAudioElement = (audio: HTMLAudioElement | null) => {
  if (!audio) return;
  audio.pause();
  audio.removeAttribute("src");
  audio.load();
};

export const useWebSocket = () => {
  const socketRef = useRef<WebSocket | null>(null);
  const activeRef = useRef(true);
  const retryRef = useRef(0);
  const reconnectTimerRef = useRef<number | null>(null);
  const shouldReconnectRef = useRef(true);
  const assistantStreamingRef = useRef(false);
  const responseDoneRef = useRef(false);
  const pendingMessagesRef = useRef<ClientOutboundMessage[]>([]);
  const responseAudioChunksRef = useRef<ReplyAudioChunk[]>([]);
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const streamingAudioRef = useRef<StreamingAudioHandle | null>(null);
  const streamingAudioFailedRef = useRef(false);
  const mutedRef = useRef(false);
  const emotionPrimaryRef = useRef("calm");
  const selectedVoiceRef = useRef(useSessionStore.getState().selectedVoice);
  const authProfileRef = useRef(useSessionStore.getState().authProfile);
  const gemmaConnectionRef = useRef(useSessionStore.getState().gemmaConnection);
  const sessionId = useSessionStore((state) => state.sessionId);
  const authProfile = useSessionStore((state) => state.authProfile);
  const selectedVoice = useSessionStore((state) => state.selectedVoice);
  const gemmaConnection = useSessionStore((state) => state.gemmaConnection);
  const muted = useSessionStore((state) => state.muted);
  const emotion = useSessionStore((state) => state.emotion);
  const setConnected = useSessionStore((state) => state.setConnected);
  const setReconnecting = useSessionStore((state) => state.setReconnecting);
  const setAssistantSpeaking = useSessionStore((state) => state.setAssistantSpeaking);
  const setEmotion = useSessionStore((state) => state.setEmotion);
  const setError = useSessionStore((state) => state.setError);
  const setMemories = useSessionStore((state) => state.setMemories);
  const appendUserTranscript = useSessionStore((state) => state.appendUserTranscript);
  const appendAiText = useSessionStore((state) => state.appendAiText);
  const appendReplyAudio = useSessionStore((state) => state.appendReplyAudio);
  const clearReplyAudio = useSessionStore((state) => state.clearReplyAudio);

  const markAssistantAudioState = useCallback(
    (state: "start" | "end") => {
      setAssistantSpeaking(state === "start");
      dispatchAssistantAudioState(state);
    },
    [setAssistantSpeaking]
  );

  const clearSpeechQueue = useCallback(() => {
    if ("speechSynthesis" in window) {
      window.speechSynthesis.cancel();
    }
    responseAudioChunksRef.current = [];
    responseDoneRef.current = false;
    streamingAudioFailedRef.current = false;
    clearAudioPlaybackRetry();
    if (streamingAudioRef.current) {
      streamingAudioRef.current.stop();
      streamingAudioRef.current = null;
    }
    if (currentAudioRef.current) {
      stopAudioElement(currentAudioRef.current);
      markAssistantAudioState("end");
    }
    currentAudioRef.current = null;
    setAssistantSpeaking(false);
  }, [markAssistantAudioState, setAssistantSpeaking]);

  useEffect(() => {
    mutedRef.current = muted;
    if (muted) clearSpeechQueue();
  }, [clearSpeechQueue, muted]);

  useEffect(() => {
    emotionPrimaryRef.current = emotion.primary;
  }, [emotion.primary]);

  useEffect(() => {
    selectedVoiceRef.current = selectedVoice;
  }, [selectedVoice]);

  useEffect(() => {
    gemmaConnectionRef.current = gemmaConnection;
  }, [gemmaConnection]);

  useEffect(() => {
    authProfileRef.current = authProfile;
  }, [authProfile]);

  const withSession = useCallback(
    (message: ClientOutboundMessage): ClientMessage => {
      const voice = selectedVoiceRef.current;
      const profile = authProfileRef.current;
      const gemma = gemmaConnectionRef.current;
      return {
        ...message,
        session_id: sessionId,
        user_id: profile?.id,
        access_token: profile?.accessToken,
        voice_id: voice?.voiceId,
        voice_profile_id: voice?.id,
        gemma_mode: gemma?.mode,
        gemma_model: gemma?.model,
        gemma_base_url: gemma?.baseUrl,
        gemma_api_key: gemma?.mode === "cloud" ? gemma.apiKey : undefined
      } as ClientMessage;
    },
    [sessionId]
  );

  useEffect(() => {
    const interruptAssistant = () => {
      clearSpeechQueue();
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(withSession({ type: "barge_in" })));
      }
    };
    window.addEventListener("lonelyfm:barge-in", interruptAssistant);
    return () => window.removeEventListener("lonelyfm:barge-in", interruptAssistant);
  }, [clearSpeechQueue, withSession]);

  const playBufferedResponse = useCallback(() => {
    if (!activeRef.current) return;
    if (mutedRef.current || responseAudioChunksRef.current.length === 0) return;
    if (!looksLikePlayableAudio(responseAudioChunksRef.current)) {
      setError("音频边界异常，已跳过这次播放。");
      return;
    }
    const url = createAudioUrl(responseAudioChunksRef.current);
    if (!url) return;
    stopAudioElement(currentAudioRef.current);
    const audio = createPlaybackAudio(url);
    currentAudioRef.current = audio;
    markAssistantAudioState("start");
    audio.onended = () => {
      currentAudioRef.current = null;
      URL.revokeObjectURL(url);
      markAssistantAudioState("end");
    };
    audio.onerror = () => {
      currentAudioRef.current = null;
      URL.revokeObjectURL(url);
      markAssistantAudioState("end");
    };
    void audio.play().catch(() => {
      currentAudioRef.current = null;
      URL.revokeObjectURL(url);
      markAssistantAudioState("end");
      queueAudioPlaybackRetry(playBufferedResponse);
      setError("浏览器阻止了自动播放，请再点一下页面。");
    });
  }, [markAssistantAudioState, setError]);

  const playStreamingChunk = useCallback(
    (chunk: ReplyAudioChunk) => {
      if (!activeRef.current) return false;
      if (mutedRef.current || streamingAudioFailedRef.current) return false;
      if (!streamingAudioRef.current) {
        if (!looksLikePlayableAudio([chunk])) {
          streamingAudioFailedRef.current = true;
          return false;
        }
        stopAudioElement(currentAudioRef.current);
        let handle: StreamingAudioHandle | null = null;
        handle = createStreamingAudioHandle(chunk.mimeType, {
          onStart: () => markAssistantAudioState("start"),
          onEnd: () => {
            if (streamingAudioRef.current === handle) {
              streamingAudioRef.current = null;
            }
            markAssistantAudioState("end");
          },
          onError: (message) => {
            if (streamingAudioRef.current === handle) {
              streamingAudioRef.current = null;
            }
            streamingAudioFailedRef.current = true;
            setError(message);
            if (responseDoneRef.current) {
              playBufferedResponse();
            }
          }
        });
        if (!handle) {
          streamingAudioFailedRef.current = true;
          return false;
        }
        streamingAudioRef.current = handle;
      }
      const appended = streamingAudioRef.current.append(chunk);
      if (!appended) streamingAudioFailedRef.current = true;
      return appended;
    },
    [markAssistantAudioState, playBufferedResponse, setError]
  );

  const playCue = useCallback(
    (chunk: ReplyAudioChunk) => {
      if (!activeRef.current) return;
      if (mutedRef.current || !looksLikePlayableAudio([chunk])) return;
      const url = createAudioUrl([chunk]);
      if (!url) return;
      stopAudioElement(currentAudioRef.current);
      const audio = createPlaybackAudio(url);
      currentAudioRef.current = audio;
      markAssistantAudioState("start");
      audio.onended = () => {
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        URL.revokeObjectURL(url);
        markAssistantAudioState("end");
      };
      audio.onerror = () => {
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        URL.revokeObjectURL(url);
        markAssistantAudioState("end");
      };
      void audio.play().catch(() => {
        if (currentAudioRef.current === audio) {
          currentAudioRef.current = null;
        }
        URL.revokeObjectURL(url);
        markAssistantAudioState("end");
        queueAudioPlaybackRetry(() => playCue(chunk));
        setError("浏览器阻止了自动播放，请再点一下页面。");
      });
    },
    [markAssistantAudioState, setError]
  );

  const handleMessage = useCallback(
    (event: MessageEvent<string>) => {
      const message = JSON.parse(event.data) as ServerMessage;
      if (!activeRef.current) return;
      if (message.type === "emotion") {
        setEmotion(message.data);
        return;
      }
      if (message.type === "transcript") {
        clearSpeechQueue();
        clearReplyAudio();
        responseAudioChunksRef.current = [];
        responseDoneRef.current = false;
        streamingAudioFailedRef.current = false;
        assistantStreamingRef.current = false;
        appendUserTranscript(message.data.text, message.data.is_final);
        return;
      }
      if (message.type === "ai_text_chunk") {
        if (!message.data.done && !assistantStreamingRef.current) {
          clearSpeechQueue();
          clearReplyAudio();
          responseDoneRef.current = false;
          assistantStreamingRef.current = true;
        }
        appendAiText(message.data.text, message.data.done);
        if (message.data.done) {
          responseDoneRef.current = true;
          assistantStreamingRef.current = false;
          if (message.data.speak === false) {
            if (streamingAudioRef.current && !streamingAudioFailedRef.current) {
              streamingAudioRef.current.finish();
            } else {
              playBufferedResponse();
            }
          } else {
            setError("这次没有收到服务端语音，只显示文字回复。");
          }
        }
        return;
      }
      if (message.type === "audio_chunk") {
        const chunk = { data: message.data.data, mimeType: message.data.mime_type ?? "audio/mpeg" };
        responseAudioChunksRef.current.push(chunk);
        appendReplyAudio(chunk);
        if (!mutedRef.current) {
          playStreamingChunk(chunk);
        }
        return;
      }
      if (message.type === "audio_cue") {
        playCue({ data: message.data.data, mimeType: message.data.mime_type ?? "audio/mpeg" });
        return;
      }
      if (message.type === "memory_sync") {
        setMemories(message.data.memories);
        return;
      }
      if (message.type === "session_ready") {
        window.dispatchEvent(new CustomEvent("lonelyfm:session-ready", { detail: message.data }));
        return;
      }
      if (message.type === "turn_cancelled") {
        clearSpeechQueue();
        clearReplyAudio();
        responseDoneRef.current = false;
        assistantStreamingRef.current = false;
        return;
      }
      if (message.type === "error") {
        setError(message.message);
      }
    },
    [
      appendAiText,
      appendReplyAudio,
      appendUserTranscript,
      clearReplyAudio,
      clearSpeechQueue,
      playBufferedResponse,
      playCue,
      playStreamingChunk,
      setEmotion,
      setError,
      setMemories
    ]
  );

  const connect = useCallback(() => {
    if (!shouldReconnectRef.current) return;
    if (socketRef.current?.readyState === WebSocket.OPEN) return;
    if (socketRef.current?.readyState === WebSocket.CONNECTING) return;
    const socket = new WebSocket(getWsUrl("/ws/chat"));
    socketRef.current = socket;

    socket.onopen = () => {
      retryRef.current = 0;
      setConnected(true);
      setReconnecting(false);
      setError(null);
      socket.send(JSON.stringify(withSession({ type: "session_start" })));
      const pendingMessages = pendingMessagesRef.current.splice(0);
      pendingMessages.forEach((pendingMessage) => {
        socket.send(JSON.stringify(withSession(pendingMessage)));
      });
    };

    socket.onmessage = handleMessage;

    socket.onerror = () => {
      setError("连接暂时不稳定，正在尝试恢复。");
    };

    socket.onclose = () => {
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      setConnected(false);
      if (!shouldReconnectRef.current) {
        setReconnecting(false);
        return;
      }
      if (retryRef.current >= 3) {
        setReconnecting(false);
        setError("连接已断开，请稍后重试。");
        return;
      }
      const delay = 1000 * 2 ** retryRef.current;
      retryRef.current += 1;
      setReconnecting(true);
      reconnectTimerRef.current = window.setTimeout(connect, delay);
    };
  }, [handleMessage, setConnected, setError, setReconnecting, withSession]);

  const send = useCallback(
    (message: ClientOutboundMessage) => {
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        if (message.type !== "session_end") {
          pendingMessagesRef.current.push(message);
          shouldReconnectRef.current = true;
          connect();
          setReconnecting(true);
          setError(`正在重新连上${selectedVoiceRef.current?.displayName ?? "频道"}。`);
        }
        return;
      }
      if (message.type === "text_input" || message.type === "audio_chunk") {
        clearSpeechQueue();
      }
      if (message.type === "session_end") {
        shouldReconnectRef.current = false;
        pendingMessagesRef.current = [];
        if (reconnectTimerRef.current) {
          window.clearTimeout(reconnectTimerRef.current);
          reconnectTimerRef.current = null;
        }
        clearSpeechQueue();
        setReconnecting(false);
      }
      socket.send(JSON.stringify(withSession(message)));
    },
    [clearSpeechQueue, connect, setError, setReconnecting, withSession]
  );

  useEffect(() => {
    activeRef.current = true;
    shouldReconnectRef.current = true;
    connect();
    return () => {
      activeRef.current = false;
      shouldReconnectRef.current = false;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      const socket = socketRef.current;
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify(withSession({ type: "session_end" })));
      }
      socket?.close();
      socketRef.current = null;
      pendingMessagesRef.current = [];
      clearSpeechQueue();
    };
  }, [clearSpeechQueue, connect, withSession]);

  return { send };
};

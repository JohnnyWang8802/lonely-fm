import type { ReplyAudioChunk } from "../types";

const SILENT_WAV_DATA_URL =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAAAAgICA";

let unlockAudio: HTMLAudioElement | null = null;
let audioPlaybackUnlocked = false;
let pendingAudioPlaybackRetry: (() => void) | null = null;

export const queueAudioPlaybackRetry = (retry: () => void): void => {
  pendingAudioPlaybackRetry = retry;
  audioPlaybackUnlocked = false;
};

export const clearAudioPlaybackRetry = (): void => {
  pendingAudioPlaybackRetry = null;
};

const runPendingAudioPlaybackRetry = (): void => {
  const retry = pendingAudioPlaybackRetry;
  pendingAudioPlaybackRetry = null;
  retry?.();
};

export const createPlaybackAudio = (url?: string): HTMLAudioElement => {
  const audio = new Audio();
  audio.preload = "auto";
  audio.setAttribute("playsinline", "true");
  if (url) audio.src = url;
  return audio;
};

export const unlockAudioPlayback = async (): Promise<boolean> => {
  if (audioPlaybackUnlocked) {
    runPendingAudioPlaybackRetry();
    return true;
  }
  if (!unlockAudio) {
    unlockAudio = createPlaybackAudio(SILENT_WAV_DATA_URL);
    unlockAudio.volume = 0.01;
  }
  try {
    await unlockAudio.play();
    unlockAudio.pause();
    unlockAudio.currentTime = 0;
    audioPlaybackUnlocked = true;
    runPendingAudioPlaybackRetry();
    return true;
  } catch {
    return false;
  }
};

export const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
  const binary = window.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

export const createAudioUrl = (chunks: ReplyAudioChunk[]): string | null => {
  if (chunks.length === 0) return null;
  const mimeType = chunks[0]?.mimeType ?? "audio/mpeg";
  const blob = new Blob(chunks.map((chunk) => base64ToArrayBuffer(chunk.data)), { type: mimeType });
  return URL.createObjectURL(blob);
};

export const looksLikePlayableAudio = (chunks: ReplyAudioChunk[]): boolean => {
  if (chunks.length === 0) return false;
  try {
    const firstBytes = new Uint8Array(base64ToArrayBuffer(chunks[0].data).slice(0, 4));
    const startsWithId3 = firstBytes[0] === 0x49 && firstBytes[1] === 0x44 && firstBytes[2] === 0x33;
    const startsWithMp3Frame = firstBytes[0] === 0xff && (firstBytes[1] & 0xe0) === 0xe0;
    const startsWithWav =
      firstBytes[0] === 0x52 && firstBytes[1] === 0x49 && firstBytes[2] === 0x46 && firstBytes[3] === 0x46;
    return startsWithId3 || startsWithMp3Frame || startsWithWav;
  } catch {
    return false;
  }
};

interface StreamingAudioCallbacks {
  onStart: () => void;
  onEnd: () => void;
  onError: (message: string) => void;
}

export interface StreamingAudioHandle {
  append: (chunk: ReplyAudioChunk) => boolean;
  finish: () => void;
  stop: () => void;
}

export const createStreamingAudioHandle = (
  mimeType: string,
  callbacks: StreamingAudioCallbacks
): StreamingAudioHandle | null => {
  if (!("MediaSource" in window)) return createSegmentAudioHandle(callbacks);
  if (!MediaSource.isTypeSupported(mimeType)) return createSegmentAudioHandle(callbacks);

  const mediaSource = new MediaSource();
  const audio = createPlaybackAudio();
  const url = URL.createObjectURL(mediaSource);
  const queue: ArrayBuffer[] = [];
  let sourceBuffer: SourceBuffer | null = null;
  let closeRequested = false;
  let stopped = false;
  let started = false;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    URL.revokeObjectURL(url);
    callbacks.onEnd();
  };

  const stop = () => {
    stopped = true;
    queue.length = 0;
    audio.pause();
    cleanup();
  };

  const startPlayback = () => {
    if (started || stopped) return;
    started = true;
    callbacks.onStart();
    void audio.play().catch(() => {
      callbacks.onError("浏览器阻止了流式播放，请先点一下页面。");
      stop();
    });
  };

  const appendNext = () => {
    if (stopped || !sourceBuffer || sourceBuffer.updating) return;
    const nextBuffer = queue.shift();
    if (nextBuffer) {
      try {
        sourceBuffer.appendBuffer(nextBuffer);
        startPlayback();
      } catch {
        callbacks.onError("流式音频追加失败，已切回完整音频播放。");
        stop();
      }
      return;
    }
    if (closeRequested && mediaSource.readyState === "open") {
      try {
        mediaSource.endOfStream();
      } catch {
        cleanup();
      }
    }
  };

  mediaSource.addEventListener(
    "sourceopen",
    () => {
      if (stopped) return;
      try {
        sourceBuffer = mediaSource.addSourceBuffer(mimeType);
        sourceBuffer.mode = "sequence";
        sourceBuffer.addEventListener("updateend", appendNext);
        sourceBuffer.addEventListener("error", () => {
          callbacks.onError("流式音频解码失败，已跳过这次播放。");
          stop();
        });
        appendNext();
      } catch {
        callbacks.onError("当前浏览器不支持这种流式音频格式。");
        stop();
      }
    },
    { once: true }
  );

  audio.src = url;
  audio.onended = cleanup;
  audio.onerror = () => {
    callbacks.onError("流式音频播放失败，已跳过这次播放。");
    stop();
  };

  return {
    append: (chunk) => {
      if (stopped) return false;
      try {
        queue.push(base64ToArrayBuffer(chunk.data));
        appendNext();
        return true;
      } catch {
        callbacks.onError("音频分片格式异常，已跳过这次播放。");
        stop();
        return false;
      }
    },
    finish: () => {
      closeRequested = true;
      appendNext();
    },
    stop
  };
};

const createSegmentAudioHandle = (callbacks: StreamingAudioCallbacks): StreamingAudioHandle => {
  const pendingChunks: ReplyAudioChunk[] = [];
  const segmentQueue: ReplyAudioChunk[][] = [];
  let flushTimer: number | null = null;
  let currentAudio: HTMLAudioElement | null = null;
  let currentUrl: string | null = null;
  let closeRequested = false;
  let stopped = false;
  let started = false;
  let cleaned = false;

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    if (currentUrl) {
      URL.revokeObjectURL(currentUrl);
      currentUrl = null;
    }
    callbacks.onEnd();
  };

  const playNext = () => {
    if (stopped || currentAudio) return;
    const nextSegment = segmentQueue.shift();
    if (!nextSegment) {
      if (closeRequested) cleanup();
      return;
    }
    const url = createAudioUrl(nextSegment);
    if (!url) {
      playNext();
      return;
    }
    currentUrl = url;
    const audio = createPlaybackAudio(url);
    currentAudio = audio;
    if (!started) {
      started = true;
      callbacks.onStart();
    }
    const releaseCurrent = () => {
      if (currentUrl === url) {
        URL.revokeObjectURL(url);
        currentUrl = null;
      }
      if (currentAudio === audio) {
        currentAudio = null;
      }
    };
    audio.onended = () => {
      releaseCurrent();
      playNext();
    };
    audio.onerror = () => {
      releaseCurrent();
      callbacks.onError("分片音频播放失败，已切回完整音频播放。");
      stop();
    };
    void audio.play().catch(() => {
      callbacks.onError("浏览器阻止了流式播放，请先点一下页面。");
      stop();
    });
  };

  const flush = () => {
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (pendingChunks.length === 0) return;
    segmentQueue.push(pendingChunks.splice(0));
    playNext();
  };

  const scheduleFlush = () => {
    if (pendingChunks.length >= 4) {
      flush();
      return;
    }
    if (!flushTimer) {
      flushTimer = window.setTimeout(flush, 90);
    }
  };

  const stop = () => {
    stopped = true;
    if (flushTimer) {
      window.clearTimeout(flushTimer);
      flushTimer = null;
    }
    pendingChunks.length = 0;
    segmentQueue.length = 0;
    currentAudio?.pause();
    currentAudio = null;
    cleanup();
  };

  return {
    append: (chunk) => {
      if (stopped) return false;
      pendingChunks.push(chunk);
      scheduleFlush();
      return true;
    },
    finish: () => {
      closeRequested = true;
      flush();
      playNext();
    },
    stop
  };
};

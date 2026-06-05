import type { CSSProperties } from "react";
import { useSessionStore } from "../store/sessionStore";

interface VoiceRecorderProps {
  callStatus: "connecting" | "active";
  elapsedSeconds: number;
  level: number;
}

const formatTime = (seconds: number) =>
  `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;

export const VoiceRecorder = ({ callStatus, elapsedSeconds, level }: VoiceRecorderProps) => {
  const listening = useSessionStore((state) => state.listening);
  const assistantSpeaking = useSessionStore((state) => state.assistantSpeaking);
  const selectedVoice = useSessionStore((state) => state.selectedVoice);
  const voiceName = selectedVoice?.displayName ?? "阿晚";

  if (callStatus === "connecting") {
    return (
      <section
        className={`restored-connection-stage restored-connection-${selectedVoice?.gender ?? "female"}`}
        aria-live="polite"
      >
        <div className="restored-connection-panel">
          <strong>正在连接{voiceName}</strong>
          <span><i /><i /><i /></span>
        </div>
      </section>
    );
  }

  const inputLevel = Math.min(level, 1);
  const audioLevel = assistantSpeaking ? 0.56 : inputLevel;
  const ringScale = 1 + audioLevel * 0.006;
  const coreScale = 1 + audioLevel * 0.012;
  const glowScale = 1 + audioLevel * 0.035;
  const glowOpacity = 0.38 + audioLevel * 0.2;
  const glowBlur = 3 + audioLevel * 4;

  return (
    <section className="restored-presence" aria-label="语音陪伴入口">
      <div className="restored-call-title">
        <strong>{voiceName} {formatTime(elapsedSeconds)}</strong>
        <span>{assistantSpeaking ? "正在说话" : "正在收听"}</span>
      </div>
      <div
        className={`restored-orb ${listening ? "is-listening" : ""} ${assistantSpeaking ? "is-speaking" : ""}`}
        aria-hidden="true"
        style={{
          "--audio-level": audioLevel,
          "--ring-scale": ringScale,
          "--core-scale": coreScale,
          "--glow-scale": glowScale,
          "--glow-opacity": glowOpacity,
          "--glow-blur": `${glowBlur}px`,
        } as CSSProperties}
      >
        <span className="restored-orb-inner" />
      </div>
    </section>
  );
};

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
  const audioLevel = assistantSpeaking ? 0.72 : inputLevel;
  const inputVoiceActive = listening && inputLevel > 0.035;
  const rippleActive = inputVoiceActive || assistantSpeaking;
  const activityLevel = rippleActive ? Math.max(audioLevel, 0.18) : 0;
  const coreScale = 1 + activityLevel * 0.018;
  const rippleOpacity = 0.24 + activityLevel * 0.32;

  return (
    <section className="restored-presence" aria-label="语音陪伴入口">
      <div className="restored-call-title">
        <strong>{voiceName} {formatTime(elapsedSeconds)}</strong>
        <span>{assistantSpeaking ? "正在说话" : "正在收听"}</span>
      </div>
      <div
        className={`restored-orb ${inputVoiceActive ? "is-listening" : ""} ${assistantSpeaking ? "is-speaking" : ""}`}
        aria-hidden="true"
        style={{
          "--audio-level": audioLevel,
          "--core-scale": coreScale,
          "--ripple-opacity": rippleOpacity,
        } as CSSProperties}
      >
        <span className="restored-orb-ripple restored-orb-ripple-one" />
        <span className="restored-orb-ripple restored-orb-ripple-two" />
        <span className="restored-orb-ripple restored-orb-ripple-three" />
        <span className="restored-orb-inner" />
      </div>
    </section>
  );
};

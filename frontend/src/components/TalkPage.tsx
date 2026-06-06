import { LogIn, LogOut, PhoneOff, Volume2, VolumeX } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { VoiceRecorder } from "./VoiceRecorder";
import { useAudioRecorder } from "../hooks/useAudioRecorder";
import { useDocumentTheme } from "../hooks/useDocumentTheme";
import { useWebSocket } from "../hooks/useWebSocket";
import { useSessionStore } from "../store/sessionStore";
import { unlockAudioPlayback } from "../utils/audio";

const Logo = () => (
  <span className="talk-brand" aria-label="Lonely FM">
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M14.8 3.9A8.5 8.5 0 1 0 14.8 20.1 7.9 7.9 0 0 1 14.8 3.9Z" fill="currentColor" />
      <path d="M15.6 9.2a4 4 0 0 1 0 5.6" stroke="#ec6676" strokeWidth="1.7" strokeLinecap="round" />
      <path d="M17.8 7.4a6.6 6.6 0 0 1 0 9.2" stroke="#ec6676" strokeWidth="1.6" strokeLinecap="round" opacity=".55" />
    </svg>
    <strong>Lonely FM</strong>
  </span>
);

const TalkPage = () => {
  const navigate = useNavigate();
  const { send } = useWebSocket();
  const { startRecording, stopRecording, level } = useAudioRecorder({ send });
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const greetingRequestedRef = useRef(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [callStatus, setCallStatus] = useState<"connecting" | "active">("connecting");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const authProfile = useSessionStore((state) => state.authProfile);
  const gemmaConnection = useSessionStore((state) => state.gemmaConnection);
  const selectedVoice = useSessionStore((state) => state.selectedVoice);
  const connected = useSessionStore((state) => state.connected);
  const listening = useSessionStore((state) => state.listening);
  const muted = useSessionStore((state) => state.muted);
  const darkMode = useSessionStore((state) => state.darkMode);
  const setMuted = useSessionStore((state) => state.setMuted);
  const clearSelectedVoice = useSessionStore((state) => state.clearSelectedVoice);
  const logout = useSessionStore((state) => state.logout);
  const voiceName = selectedVoice?.displayName ?? "阿晚";
  const accountInitial = Array.from(authProfile?.name || authProfile?.email || "访")[0]?.toUpperCase() || "访";

  useDocumentTheme(darkMode);

  useEffect(() => {
    if (!authProfile) {
      navigate("/login", { replace: true });
    } else if (!gemmaConnection?.ready) {
      navigate("/setup", { replace: true });
    } else if (!selectedVoice) {
      navigate("/voice-select", { replace: true });
    }
  }, [authProfile, gemmaConnection?.ready, navigate, selectedVoice]);

  useEffect(() => {
    void unlockAudioPlayback();
  }, []);

  useEffect(() => {
    if (!connected || greetingRequestedRef.current) return;
    greetingRequestedRef.current = true;
    send({ type: "session_greeting" });
  }, [connected, send]);

  useEffect(() => {
    let listeningFallback = 0;
    const handleReady = () => {
      setCallStatus("active");
      listeningFallback = window.setTimeout(() => {
        if (!useSessionStore.getState().assistantSpeaking && !useSessionStore.getState().listening) {
          void startRecording();
        }
      }, 5000);
    };
    const handleGreetingEnd = () => {
      if (!useSessionStore.getState().listening) void startRecording();
    };
    window.addEventListener("lonelyfm:session-ready", handleReady);
    window.addEventListener("lonelyfm:assistant-audio-end", handleGreetingEnd);
    return () => {
      window.clearTimeout(listeningFallback);
      window.removeEventListener("lonelyfm:session-ready", handleReady);
      window.removeEventListener("lonelyfm:assistant-audio-end", handleGreetingEnd);
    };
  }, [startRecording]);

  useEffect(() => {
    if (callStatus !== "active") return;
    const timer = window.setInterval(() => setElapsedSeconds((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [callStatus]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const close = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [accountMenuOpen]);

  const closeSessionAudio = () => {
    if (listening) stopRecording();
    send({ type: "session_end" });
  };

  const endSession = () => {
    closeSessionAudio();
    clearSelectedVoice();
    navigate("/voice-select", { replace: true });
  };

  const goHome = () => {
    closeSessionAudio();
    navigate("/", { replace: true });
  };

  const goToLogin = () => {
    closeSessionAudio();
    logout();
    navigate("/login", { replace: true });
  };

  const logoutFromTalk = () => {
    closeSessionAudio();
    logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="app-shell restored-talk-shell">
      <header className="restored-talk-header">
        <button className="talk-brand-button" type="button" aria-label="返回 Lonely FM 首页" onClick={goHome}>
          <Logo />
        </button>
        <div className="account-menu" ref={accountMenuRef}>
          <button
            className="account-avatar restored-avatar"
            type="button"
            aria-label={`当前登录账号：${authProfile?.email ?? authProfile?.name ?? "访客"}`}
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            {accountInitial}
          </button>
          {accountMenuOpen && (
            <div className="account-popover restored-account-popover">
              <div className="account-popover-identity">
                <div>
                  <strong>{authProfile?.name ?? "访客"}</strong>
                  <span>{authProfile?.email ?? "访客模式"}</span>
                </div>
              </div>
              {authProfile?.provider === "guest" ? (
                <button className="account-logout" type="button" onClick={goToLogin}>
                  <LogIn size={16} />登录以保存记忆
                </button>
              ) : (
                <button className="account-logout" type="button" onClick={logoutFromTalk}>
                  <LogOut size={16} />退出登录
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="restored-talk-main">
        <VoiceRecorder callStatus={callStatus} elapsedSeconds={elapsedSeconds} level={level} />
      </main>

      {callStatus === "active" && (
        <footer className="restored-control-dock" aria-label="语音控制">
          <button type="button" onClick={() => setMuted(!muted)}>
            {muted ? <VolumeX size={19} /> : <Volume2 size={19} />}
            {muted ? "取消静音" : "静音"}
          </button>
          <button className="restored-end-button" type="button" onClick={endSession}>
            <PhoneOff size={19} />结束
          </button>
        </footer>
      )}
    </div>
  );
};

export default TalkPage;

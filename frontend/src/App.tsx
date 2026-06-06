import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Cloud,
  Headphones,
  KeyRound,
  Loader2,
  LogOut,
  Mail,
  Mic2,
  Phone,
  PhoneCall,
  Radio,
  RefreshCw,
  ShieldCheck,
  Terminal
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import TalkPage from "./components/TalkPage";
import { useTypewriter } from "./hooks/useTypewriter";
import { useSessionStore } from "./store/sessionStore";
import { profileFromSession, sendLoginEmail, supabase, supabaseConfigured } from "./services/supabase";
import {
  checkLocalGemma,
  createCloudGemmaConnection,
  createLocalGemmaConnection,
  RECOMMENDED_LOCAL_GEMMA_MODEL
} from "./services/gemmaConnection";
import { VOICE_PROFILES } from "./voiceProfiles";

const LogoMark = () => (
  <svg className="logo-mark" width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    {/* crescent (night) — adapts to text color */}
    <path d="M14.8 3.9A8.5 8.5 0 1 0 14.8 20.1 7.9 7.9 0 0 1 14.8 3.9Z" fill="currentColor" />
    {/* signal ripples (the warm voice) — constant brand coral */}
    <path d="M15.6 9.2a4 4 0 0 1 0 5.6" stroke="#ec6676" strokeWidth="1.7" strokeLinecap="round" opacity="0.95" />
    <path d="M17.8 7.4a6.6 6.6 0 0 1 0 9.2" stroke="#ec6676" strokeWidth="1.6" strokeLinecap="round" opacity="0.55" />
  </svg>
);

const Logo = () => (
  <div className="logo" aria-label="Lonely FM">
    <LogoMark />
    <span>Lonely FM</span>
  </div>
);

const HERO_LINE = "你好。先别急着说得完整 —— 挑最想说的那一句就好。今晚，想从哪里开始？";

const HomePage = () => {
  const [chipsIn, setChipsIn] = useState(false);
  const intro = useTypewriter(HERO_LINE);
  const heroRef = useRef<HTMLElement>(null);
  const authProfile = useSessionStore((state) => state.authProfile);
  const logout = useSessionStore((state) => state.logout);

  // Dynamic background color matching video edges
  const [videoBgColor, setVideoBgColor] = useState<string>("#f1e1d4");

  // Video references and states for scrubbing
  const videoRef = useRef<HTMLVideoElement>(null);
  const targetTimeRef = useRef<number>(0);
  const prevXRef = useRef<number | null>(null);
  const seekingRef = useRef<boolean>(false);

  useEffect(() => {
    if (authProfile?.provider === "guest") logout();
  }, [authProfile?.provider, logout]);

  useEffect(() => {
    const timer = window.setTimeout(() => setChipsIn(true), 450);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    let frame = 0;
    const handleMouseMove = (event: MouseEvent) => {
      // 1. 3D perspective rotation on hover
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
          const mx = (event.clientX / window.innerWidth - 0.5) * 2;
          const my = (event.clientY / window.innerHeight - 0.5) * 2;
          const el = heroRef.current;
          if (el) {
            el.style.setProperty("--hero-mx", mx.toFixed(3));
            el.style.setProperty("--hero-my", my.toFixed(3));
          }
        });
      }

      // 2. Video scrubbing based on mouse movement
      const video = videoRef.current;
      if (!video || isNaN(video.duration)) return;

      const currentX = event.clientX;
      if (prevXRef.current === null) {
        prevXRef.current = currentX;
        return;
      }

      const delta = currentX - prevXRef.current;
      prevXRef.current = currentX;

      const SENSITIVITY = 0.8;
      const timeOffset = (delta / window.innerWidth) * SENSITIVITY * video.duration;

      let newTime = targetTimeRef.current + timeOffset;
      if (newTime < 0) newTime = 0;
      if (newTime > video.duration) newTime = video.duration;

      targetTimeRef.current = newTime;

      if (!seekingRef.current) {
        seekingRef.current = true;
        video.currentTime = newTime;
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      cancelAnimationFrame(frame);
    };
  }, [authProfile, logout]);

  const handleSeeked = () => {
    const video = videoRef.current;
    if (!video) return;

    if (Math.abs(video.currentTime - targetTimeRef.current) > 0.01) {
      video.currentTime = targetTimeRef.current;
    } else {
      seekingRef.current = false;
    }
  };

  const extractColor = (video: HTMLVideoElement) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 10;
      canvas.height = 10;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(video, 0, 0, 10, 10);
        const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
        if (r > 0 || g > 0 || b > 0) {
          const hex = `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
          setVideoBgColor(hex);
          console.log("Extracted home hero video edge color:", hex);
        }
      }
    } catch (err) {
      console.error("Failed to extract color from video:", err);
    }
  };

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    targetTimeRef.current = video.currentTime;
    extractColor(video);
  };

  const handleCanPlay = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    extractColor(e.currentTarget);
  };

  return (
    <div className="home-shell" style={{ backgroundColor: videoBgColor }}>
      <header className="home-nav" style={{ backgroundColor: "transparent" }}>
        <div className="home-logo-link" aria-label="Lonely FM 首页">
          <Logo />
        </div>
        <nav className="home-nav-links" aria-label="主页导航">
          <a href="#voice">声音</a>
          <a href="#good">陪伴</a>
        </nav>
        <Link className="home-nav-action" to="/login">
          进入频道
        </Link>
      </header>

      <main>
        <section className="home-hero" aria-labelledby="home-title" ref={heroRef}>
          <div className="hero-bg" aria-hidden="true">
            <div className="hero-bg-art" style={{ backgroundColor: videoBgColor }} />
            <video
              ref={videoRef}
              src="/companion.mp4"
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={handleLoadedMetadata}
              onCanPlay={handleCanPlay}
              onSeeked={handleSeeked}
              className="hero-img"
            />
            <div className="hero-scrim" />
          </div>

          <div className="hero-stage">
            <p className="hero-eyebrow">深夜频道 · 在吗</p>
            <p className="hero-whisper" aria-hidden="true">
              现在是深夜频道。
              <br />
              我是阿晚，在这头听着。
            </p>
            <h1 id="home-title" className="hero-line">
              {intro.displayed}
              {!intro.done && <span className="hero-caret" aria-hidden="true" />}
            </h1>
            <div className={`hero-chips ${chipsIn ? "is-in" : ""}`}>
              <Link className="chip chip-solid" to="/login">
                开始说话
                <ArrowRight size={16} />
              </Link>
              <Link className="chip chip-soft" to="/login">
                先听你讲个故事
              </Link>
              <Link className="chip chip-soft" to="/login">
                只是想有人在
              </Link>
            </div>
          </div>
        </section>

        <section className="home-section home-intro" id="voice" aria-labelledby="voice-title">
          <div>
            <p className="section-eyebrow">Voice first</p>
            <h2 id="voice-title">
              <span>不是聊天窗口，</span>
              <span>是一个会接话的声音。</span>
            </h2>
          </div>
          <p>
            Lonely FM 把界面压到最少。进入频道、选择声线、开口说话就好。它用有情绪起伏的语音和可删除的记忆，把"陪伴"做得更自然，而不是再多一个对话框。
          </p>
        </section>

        <section className="home-principles" id="good" aria-label="陪伴方式">
          <article className="principle-card principle-card-primary">
            <Mic2 size={22} />
            <h3>先听完，再回应</h3>
            <p>用自然的轮流和停顿感知减少抢话，让沉默、停顿和犹豫都被尊重。</p>
          </article>
          <article className="principle-card">
            <Headphones size={22} />
            <h3>像电台，不像客服</h3>
            <p>声线保持知性、热情、亲近，少说教，多接住。</p>
          </article>
          <article className="principle-card">
            <ShieldCheck size={22} />
            <h3>为低落时刻设计</h3>
            <p>围绕独居、深夜、疲惫和无处倾诉，做温和但有边界的陪伴。</p>
          </article>
        </section>

        <section className="home-dark-band">
          <div>
            <p className="section-eyebrow">随时开始</p>
            <h2>想说话的时候，它就在。</h2>
            <p>
              不需要理由，也不需要说得很完整。挑最想说的那一句开口，剩下的可以慢慢来。
            </p>
          </div>
          <Link className="home-button home-button-inverted" to="/login">
            开始说话
            <Radio size={18} />
          </Link>
        </section>
      </main>
    </div>
  );
};

const makeAuthProfile = (provider: "guest") => ({
  id: `demo-${provider}-${crypto.randomUUID()}`,
  name: "访客",
  provider,
  signedInAt: new Date().toISOString()
});

const LOGIN_EMAIL_COOLDOWN_SECONDS = 60;

const getReadableAuthError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error || "");
  const authError = error as { code?: string; error_code?: string; status?: number } | null;
  const details = [message, authError?.code, authError?.error_code, authError?.status]
    .filter(Boolean)
    .join(" ");
  if (/rate|429|over_email_send_rate_limit/i.test(details)) {
    return "登录邮件发送太频繁了，请稍等 1 分钟后再试。";
  }
  if (/sending confirmation email/i.test(message)) {
    return "邮件服务发送失败：请检查 Supabase Auth 的 SMTP/Resend 配置。";
  }
  if (/redirect/i.test(message)) {
    return "登录跳转地址未允许：请把 Vercel 域名加入 Supabase Redirect URLs。";
  }
  if (/rate/i.test(message)) {
    return "请求太频繁，请稍后再试。";
  }
  return message ? `登录邮件发送失败：${message}` : "登录邮件发送失败，请稍后重试。";
};

const LoginPage = () => {
  const navigate = useNavigate();
  const login = useSessionStore((state) => state.login);
  const logout = useSessionStore((state) => state.logout);
  const authProfile = useSessionStore((state) => state.authProfile);
  const guestTrialStartingRef = useRef(false);
  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (authProfile?.provider === "guest" && !guestTrialStartingRef.current) {
      logout();
      return;
    }
    if (authProfile) {
      navigate("/setup", { replace: true });
    }
  }, [authProfile, logout, navigate]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setResendCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [resendCooldown]);

  const requestLoginEmail = async () => {
    if (!supabaseConfigured) {
      setStatus("云端登录尚未配置。");
      return;
    }
    if (resendCooldown > 0) {
      setStatus(`登录邮件刚刚发出，请 ${resendCooldown} 秒后再重新发送。`);
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      setStatus("请输入有效邮箱。");
      return;
    }
    setSubmitting(true);
    try {
      await sendLoginEmail(normalizedEmail);
      setEmail(normalizedEmail);
      setEmailSent(true);
      setResendCooldown(LOGIN_EMAIL_COOLDOWN_SECONDS);
      setStatus("登录邮件已发送。请打开邮箱，点击邮件里的确认链接完成登录。");
    } catch (error) {
      console.error("Supabase email login failed", error);
      setStatus(getReadableAuthError(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="login-shell">
      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-content">
          <Link className="login-mark" to="/" aria-label="返回 Lonely FM 首页">
            <Logo />
          </Link>
          <div className="login-copy">
            <h1 id="login-title">登录，让频道记得你</h1>
            <p>同步你愿意留下的记忆，在不同设备上继续熟悉的对话。</p>
          </div>
          <form className="login-actions" aria-label="邮箱登录" onSubmit={(event) => {
            event.preventDefault();
            void requestLoginEmail();
          }}>
            <label className="login-field" aria-label="邮箱">
              <Mail size={17} aria-hidden="true" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="输入邮箱"
                autoComplete="email"
              />
            </label>

            {status && (
              <p className="login-status" role="status" aria-live="polite">
                {status}
              </p>
            )}

            <button className="login-submit" type="submit" disabled={submitting || resendCooldown > 0}>
              {submitting
                ? "请稍候..."
                : resendCooldown > 0
                  ? `${resendCooldown} 秒后可重发`
                  : emailSent
                    ? "重新发送登录邮件"
                    : "获取登录邮件"}
            </button>
          </form>

          <div className="login-divider-container" aria-hidden="true">
            <span className="login-divider-line"></span>
            <span className="login-divider-text">或</span>
            <span className="login-divider-line"></span>
          </div>
          <button
            className="login-skip"
            type="button"
            onClick={() => {
              guestTrialStartingRef.current = true;
              login(makeAuthProfile("guest"));
              navigate("/setup", { replace: true });
            }}
          >
            先体验一次对话
          </button>

          <p className="login-footnote">
            登录后启用长期记忆；记忆由你决定保留，并可随时删除。
          </p>
        </div>
      </section>

      <div className="login-visual" aria-hidden="true">
        <img className="login-visual-img" src="/login-visual.png" alt="陪伴" />
      </div>
    </div>
  );
};

const GemmaSetupPage = () => {
  const navigate = useNavigate();
  const authProfile = useSessionStore((state) => state.authProfile);
  const gemmaConnection = useSessionStore((state) => state.gemmaConnection);
  const setGemmaConnection = useSessionStore((state) => state.setGemmaConnection);
  const logout = useSessionStore((state) => state.logout);
  const [checking, setChecking] = useState(false);
  const [localResult, setLocalResult] = useState<Awaited<ReturnType<typeof checkLocalGemma>> | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [cloudStatus, setCloudStatus] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!authProfile) {
      navigate("/login", { replace: true });
    }
  }, [authProfile, navigate]);

  useEffect(() => {
    if (gemmaConnection?.ready) {
      navigate("/voice-select", { replace: true });
    }
  }, [gemmaConnection?.ready, navigate]);

  const runLocalCheck = async () => {
    setChecking(true);
    setLocalResult(null);
    try {
      const result = await checkLocalGemma();
      setLocalResult(result);
      if (result.ok) {
        setGemmaConnection(createLocalGemmaConnection(result.selectedModel));
      }
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    void runLocalCheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const installCommand = `ollama pull ${RECOMMENDED_LOCAL_GEMMA_MODEL}`;
  const backendCommand = "cd backend && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 8001";
  const originCommand = `launchctl setenv OLLAMA_ORIGINS "https://lonely-fm.vercel.app,http://localhost:5173,http://127.0.0.1:5173"`;

  const copyInstallCommand = async () => {
    try {
      await navigator.clipboard.writeText(installCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const copyOriginCommand = async () => {
    try {
      await navigator.clipboard.writeText(originCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const copyBackendCommand = async () => {
    try {
      await navigator.clipboard.writeText(backendCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  const useCloudApi = () => {
    const value = apiKey.trim();
    if (value.length < 12) {
      setCloudStatus("请输入有效的 Gemma 4 API key。");
      return;
    }
    setGemmaConnection(createCloudGemmaConnection(value));
    setCloudStatus("已选择云端 Gemma 4。");
  };

  const leaveGuest = () => {
    logout();
    navigate("/", { replace: true });
  };

  return (
    <div className="setup-shell">
      <header className="setup-header">
        <div className="home-logo-link" aria-label="Lonely FM">
          <Logo />
        </div>
        <button className="setup-quiet-button" type="button" onClick={leaveGuest}>
          返回首页
        </button>
      </header>

      <main className="setup-main" aria-labelledby="setup-title">
        <section className="setup-copy">
          <p className="section-eyebrow">Gemma first</p>
          <h1 id="setup-title">先连接你的 Gemma 4。</h1>
          <p>
            Lonely FM 默认优先连接你电脑上的本地后端，再由本地后端调用 Ollama / Gemma 4。
            这样更私密，也更适合情绪陪伴场景；没有本地模型时，再使用云端 API key。
          </p>
        </section>

        <section className="setup-panel" aria-label="Gemma 连接方式">
          <div className="setup-card setup-card-primary">
            <div className="setup-card-heading">
              <span className="setup-icon">
                {checking ? <Loader2 className="setup-spin" size={22} /> : localResult?.ok ? <CheckCircle2 size={22} /> : <Terminal size={22} />}
              </span>
              <div>
                <h2>本地 Ollama / Gemma 4</h2>
                <p>
                  {checking
                    ? "正在检测这台电脑是否已经启动本地后端和 Ollama..."
                    : localResult?.ok
                      ? `已检测到 ${localResult.selectedModel ?? "本地 Gemma 4"}，可以进入频道。`
                      : "没有检测到可用的本地 Gemma 4。"}
                </p>
              </div>
            </div>

            {localResult && !localResult.ok && (
              <div className="setup-guidance">
                <div className="setup-alert">
                  <AlertCircle size={18} />
                  <span>
                    {localResult.error}
                  </span>
                </div>
                {localResult.setupHint && <p className="setup-hint">{localResult.setupHint}</p>}
                <div className="setup-step-list" aria-label="本地连接步骤">
                  <span>1. 启动 Ollama。</span>
                  <span>2. 启动 Lonely FM 本地后端。</span>
                  <span>3. 回到这里重新检测。</span>
                </div>
                <div className="setup-command">
                  <code>{installCommand}</code>
                  <button type="button" onClick={copyInstallCommand}>
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                <p className="setup-hint">也兼容 gemma4:e4b 和 gemma4:21b；只要模型名以 gemma4 开头即可。</p>
                <div className="setup-command">
                  <code>{backendCommand}</code>
                  <button type="button" onClick={copyBackendCommand}>
                    {copied ? "已复制" : "复制"}
                  </button>
                </div>
                {!localResult.ollamaAvailable && (
                  <div className="setup-command setup-command-subtle">
                    <code>{originCommand}</code>
                    <button type="button" onClick={copyOriginCommand}>
                      {copied ? "已复制" : "复制"}
                    </button>
                  </div>
                )}
                <a className="setup-link" href="https://ollama.com/download" target="_blank" rel="noreferrer">
                  下载 Ollama
                </a>
              </div>
            )}

            <button className="setup-action" type="button" onClick={() => void runLocalCheck()} disabled={checking}>
              <RefreshCw size={17} />
              {checking ? "检测中..." : "重新检测本地 Gemma"}
            </button>
          </div>

          <div className="setup-card">
            <div className="setup-card-heading">
              <span className="setup-icon">
                <Cloud size={22} />
              </span>
              <div>
                <h2>云端 Gemma 4 API</h2>
                <p>没有本地模型时，可以使用自己的 API key。适合手机、平板或临时测试。</p>
              </div>
            </div>

            <label className="setup-api-field">
              <KeyRound size={17} aria-hidden="true" />
              <input
                type="password"
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="输入 Gemma 4 API key"
                autoComplete="off"
              />
            </label>
            {cloudStatus && <p className="setup-status">{cloudStatus}</p>}
            <button className="setup-action setup-action-dark" type="button" onClick={useCloudApi}>
              使用云端 API 继续
            </button>
          </div>
        </section>
      </main>
    </div>
  );
};

const VoiceSelectPage = () => {
  const navigate = useNavigate();
  const setSelectedVoice = useSessionStore((state) => state.setSelectedVoice);
  const authProfile = useSessionStore((state) => state.authProfile);
  const gemmaConnection = useSessionStore((state) => state.gemmaConnection);
  const clearSelectedVoice = useSessionStore((state) => state.clearSelectedVoice);
  const logout = useSessionStore((state) => state.logout);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountInitial = Array.from(authProfile?.name || authProfile?.email || "访")[0]?.toUpperCase() || "访";

  useEffect(() => {
    if (!authProfile) {
      navigate("/login", { replace: true });
    } else if (!gemmaConnection?.ready) {
      navigate("/setup", { replace: true });
    }
  }, [authProfile, gemmaConnection?.ready, navigate]);

  useEffect(() => {
    if (!accountMenuOpen) return;
    const closeMenu = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) setAccountMenuOpen(false);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [accountMenuOpen]);

  const handleSelect = (voice: (typeof VOICE_PROFILES)[number]) => {
    setSelectedVoice(voice);
    navigate("/talk", { replace: true });
  };

  const handleLogout = () => {
    clearSelectedVoice();
    logout();
    navigate("/", { replace: true });
  };

  const handleGuestLogin = () => {
    clearSelectedVoice();
    logout();
    navigate("/login", { replace: true });
  };

  const companionDetails: Record<string, { subtitle: string; description: string; tags: string[]; image: string }> = {
    linyu: {
      subtitle: "深夜电台 / 安静、克制、善于倾听",
      description: "像月光一样，陪你把情绪慢慢说完。",
      tags: ["理性温柔", "深度倾听", "治愈陪伴"],
      image: "/linyu-card.png"
    },
    awan: {
      subtitle: "温柔陪伴 / 轻松、治愈、会接住你的话",
      description: "像夜灯一样，在你需要的时候一直都在。",
      tags: ["温暖治愈", "轻松愉快", "贴心陪伴"],
      image: "/awan-card.png"
    }
  };

  return (
    <div className="voice-select-shell custom-voice-select-shell">
      <header className="custom-voice-select-header">
        <Link to="/" aria-label="返回 Lonely FM 首页"><Logo /></Link>
        <div className="account-menu" ref={accountMenuRef}>
          <button
            className="account-avatar custom-avatar"
            type="button"
            aria-label={`当前登录账号：${authProfile?.email ?? authProfile?.name ?? "访客"}`}
            aria-expanded={accountMenuOpen}
            onClick={() => setAccountMenuOpen((open) => !open)}
          >
            {accountInitial}
          </button>
          {accountMenuOpen && (
            <div className="account-popover custom-account-popover">
              <div className="account-popover-identity">
                <div>
                  <strong>{authProfile?.name ?? "访客"}</strong>
                  <span>{authProfile?.email ?? "访客模式"}</span>
                </div>
              </div>
              {authProfile?.provider === "guest" ? (
                <button className="account-logout" type="button" onClick={handleGuestLogin}>
                  <Mail size={16} />登录以保存记忆
                </button>
              ) : (
                <button className="account-logout" type="button" onClick={handleLogout}>
                  <LogOut size={16} />退出登录
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="custom-voice-select-main">
        <div className="voice-select-heading">
          <h1>选择一位陪伴你的声音</h1>
          <p className="voice-select-subheading">不同的声音，不同的陪伴方式，总有一位懂你此刻的心情。</p>
        </div>

        <div className="voice-cards-container">
          {VOICE_PROFILES.map((voice) => {
            const detail = companionDetails[voice.id];
            if (!detail) return null;

            return (
              <div
                key={voice.id}
                className={`voice-card voice-card-${voice.id}`}
                onClick={() => handleSelect(voice)}
              >
                {voice.id === "linyu" ? (
                  <>
                    <div className="voice-card-content">
                      <div className="voice-card-name-row">
                        <PhoneCall className="voice-card-phone-icon" size={24} />
                        <h2>{voice.displayName}</h2>
                      </div>
                      <p className="voice-card-subtitle">{detail.subtitle}</p>
                      <p className="voice-card-description">{detail.description}</p>
                      <div className="voice-card-tags">
                        {detail.tags.map((tag) => (
                          <span key={tag} className="voice-card-tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="voice-card-media-wrapper">
                      <img className="voice-card-img" src={detail.image} alt={voice.displayName} />
                      <div className="voice-card-fade-overlay fade-to-left" />
                    </div>
                  </>
                ) : (
                  <>
                    <div className="voice-card-media-wrapper">
                      <img className="voice-card-img" src={detail.image} alt={voice.displayName} />
                      <div className="voice-card-fade-overlay fade-to-right" />
                    </div>
                    <div className="voice-card-content">
                      <div className="voice-card-name-row">
                        <PhoneCall className="voice-card-phone-icon" size={24} />
                        <h2>{voice.displayName}</h2>
                      </div>
                      <p className="voice-card-subtitle">{detail.subtitle}</p>
                      <p className="voice-card-description">{detail.description}</p>
                      <div className="voice-card-tags">
                        {detail.tags.map((tag) => (
                          <span key={tag} className="voice-card-tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
};

const App = () => {
  const login = useSessionStore((state) => state.login);

  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) login(profileFromSession(data.session));
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) login(profileFromSession(session));
    });
    return () => data.subscription.unsubscribe();
  }, [login]);

  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<GemmaSetupPage />} />
      <Route path="/voice-select" element={<VoiceSelectPage />} />
      <Route path="/talk" element={<TalkPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;

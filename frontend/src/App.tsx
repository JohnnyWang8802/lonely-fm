import { ArrowRight, Headphones, LogOut, Mail, Mic2, PhoneCall, Radio, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import TalkPage from "./components/TalkPage";
import { useTypewriter } from "./hooks/useTypewriter";
import { useSessionStore } from "./store/sessionStore";
import { profileFromSession, sendEmailCode, supabase, supabaseConfigured, verifyEmailCode } from "./services/supabase";
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

  useEffect(() => {
    if (authProfile?.provider === "guest") logout();
  }, [authProfile?.provider, logout]);

  useEffect(() => {
    const timer = window.setTimeout(() => setChipsIn(true), 450);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    const onMove = (event: MouseEvent) => {
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
    };
    window.addEventListener("mousemove", onMove);
    return () => {
      window.removeEventListener("mousemove", onMove);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <div className="home-shell">
      <header className="home-nav">
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
            <div className="hero-bg-art" />
            <img className="hero-img" src="/hero.webp" alt="" />
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

const LoginPage = () => {
  const navigate = useNavigate();
  const login = useSessionStore((state) => state.login);
  const logout = useSessionStore((state) => state.logout);
  const authProfile = useSessionStore((state) => state.authProfile);
  const guestTrialStartingRef = useRef(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (authProfile?.provider === "guest" && !guestTrialStartingRef.current) {
      logout();
      return;
    }
    if (authProfile) {
      navigate("/voice-select", { replace: true });
    }
  }, [authProfile, logout, navigate]);

  const requestCode = async () => {
    if (!supabaseConfigured) {
      setStatus("云端登录尚未配置。");
      return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail.includes("@")) {
      setStatus("请输入有效邮箱。");
      return;
    }
    setSubmitting(true);
    try {
      await sendEmailCode(normalizedEmail);
      setEmail(normalizedEmail);
      setCodeSent(true);
      setStatus("6 位验证码已发送，请查看邮箱。");
    } catch {
      setStatus("验证码发送失败，请稍后重试。");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyCode = async () => {
    if (!/^\d{6}$/.test(code)) {
      setStatus("请输入邮件中的 6 位验证码。");
      return;
    }
    setSubmitting(true);
    try {
      const session = await verifyEmailCode(email, code);
      login(profileFromSession(session));
      setStatus("登录成功，正在进入频道。");
    } catch {
      setStatus("验证码无效或已过期，请重新发送。");
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
          <form className="login-actions" aria-label="邮箱验证码登录" onSubmit={(event) => {
            event.preventDefault();
            void (codeSent ? verifyCode() : requestCode());
          }}>
            <label className="login-field" aria-label="邮箱">
              <Mail size={17} aria-hidden="true" />
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="输入邮箱"
                autoComplete="email"
                disabled={codeSent}
              />
            </label>

            {codeSent && (
              <label className="login-field login-field-code" aria-label="验证码">
                <span aria-hidden="true">#</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="输入 6 位验证码"
                  maxLength={6}
                  autoComplete="one-time-code"
                />
              </label>
            )}

            {status && (
              <p className="login-status" role="status" aria-live="polite">
                {status}
              </p>
            )}

            <button className="login-submit" type="submit" disabled={submitting}>
              {submitting ? "请稍候..." : codeSent ? "验证并登录" : "获取邮箱验证码"}
            </button>
          </form>

          <div className="login-divider" aria-hidden="true" />
          <button
            className="login-skip"
            type="button"
            onClick={() => {
              guestTrialStartingRef.current = true;
              login(makeAuthProfile("guest"));
              navigate("/voice-select", { replace: true });
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
        <img className="login-visual-img" src="/login-grid.png" alt="" />
      </div>
    </div>
  );
};

const VoiceSelectPage = () => {
  const navigate = useNavigate();
  const setSelectedVoice = useSessionStore((state) => state.setSelectedVoice);
  const authProfile = useSessionStore((state) => state.authProfile);
  const clearSelectedVoice = useSessionStore((state) => state.clearSelectedVoice);
  const logout = useSessionStore((state) => state.logout);
  const accountMenuRef = useRef<HTMLDivElement>(null);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const accountInitial = Array.from(authProfile?.name || authProfile?.email || "访")[0]?.toUpperCase() || "访";

  useEffect(() => {
    if (!authProfile) {
      navigate("/login", { replace: true });
    }
  }, [authProfile, navigate]);

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

  return (
    <div className="voice-select-shell restored-voice-select-shell">
      <header className="restored-voice-select-header">
        <Link to="/" aria-label="返回 Lonely FM 首页"><Logo /></Link>
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
                <span className="account-popover-avatar">{accountInitial}</span>
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

      <main className="restored-voice-select-main" aria-label="选择一个声音">
        <div className="restored-voice-panel" role="list" aria-label="声音选择">
          {VOICE_PROFILES.map((voice) => (
            <button
              key={voice.id}
              className={`restored-voice-choice restored-voice-${voice.gender}`}
              type="button"
              onClick={() => handleSelect(voice)}
              role="listitem"
              aria-label={`接通${voice.displayName}`}
            >
              <PhoneCall size={25} aria-hidden="true" />
              <strong>{voice.displayName}</strong>
            </button>
          ))}
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
      <Route path="/voice-select" element={<VoiceSelectPage />} />
      <Route path="/talk" element={<TalkPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;

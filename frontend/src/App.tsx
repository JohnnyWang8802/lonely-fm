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
  Terminal,
  Users
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

const MarketingNav = () => (
  <header className="home-nav">
    <Link className="home-logo-link" to="/" aria-label="Lonely FM 首页">
      <Logo />
    </Link>
    <nav className="home-nav-links" aria-label="主页导航">
      <Link className="home-nav-text-link" to="/background">背景</Link>
      <Link className="home-nav-text-link" to="/technology">技术</Link>
      <Link className="home-nav-text-link" to="/team">团队</Link>
      <Link className="home-nav-action" to="/login">
        进入频道
      </Link>
    </nav>
  </header>
);

const BACKGROUND_POINTS = [
  {
    icon: Radio,
    title: "孤独不止一种",
    body: "它可能在深夜、在通勤路上、在一个人的房间里出现，也可能只是突然想有人听一会儿。Lonely FM 先承认这些时刻，而不急着给建议。"
  },
  {
    icon: Mic2,
    title: "开口就是一道坎",
    body: "打字要先组织语言，专业咨询又显得太重。把入口做成一通电话，是想让人用最自然的方式开始——说一句就好。"
  },
  {
    icon: ShieldCheck,
    title: "陪伴也要有边界",
    body: "它不替代医疗，也不制造依赖。访客离开即不留痕，登录后的记忆由你决定保留或删除——让温暖和安全感同时成立。"
  }
];

const TECHNOLOGY_STEPS = [
  {
    icon: Terminal,
    title: "本地 Gemma 4 优先",
    body: "优先检测用户电脑上的 Ollama / Gemma 4，兼容可用的本地模型标签。这样更私密，也更适合低成本、可持续的 AI for Good 场景。"
  },
  {
    icon: Cloud,
    title: "云端 API 作为补充",
    body: "没有本地模型，或需要在手机、平板、临时设备上测试时，用户可以输入自己的 Gemma 4 API key，保留第二条可用路径。"
  },
  {
    icon: Headphones,
    title: "实时语音链路",
    body: "前端处理麦克风、VAD、连接中和轮流说话；后端把识别文本交给 Gemma 4，再交给情绪化 TTS，尽量缩短沉默和等待。"
  },
  {
    icon: ShieldCheck,
    title: "记忆按账号隔离",
    body: "Supabase 负责登录和可删除记忆。访客会话不留长期记录，登录用户的记忆只服务于自己的下一次对话。"
  }
];

const BackgroundPage = () => (
  <div className="info-shell narrative-shell">
    <MarketingNav />
    <main className="narrative-main">
      <section className="narrative-hero">
        <div>
          <p className="section-eyebrow">Background</p>
          <h1>
            <span>Lonely FM 想解决的，</span>
            <span>不是无聊，是无人可说。</span>
          </h1>
        </div>
        <p>
          很多低落不发生在医院或咨询室，而是在深夜、独居、疲惫、下班后的房间里。那一刻，人需要的不是复杂的功能，而是一个愿意先听完、能接住情绪的声音。
        </p>
      </section>

      <section className="narrative-feature-grid" aria-label="背景与痛点">
        {BACKGROUND_POINTS.map((point, index) => {
          const Icon = point.icon;
          return (
            <article className="narrative-feature" key={point.title}>
              <div className="narrative-feature-top">
                <span>{String(index + 1).padStart(2, "0")}</span>
                <Icon size={22} />
              </div>
              <h2>{point.title}</h2>
              <p>{point.body}</p>
            </article>
          );
        })}
      </section>

      <section className="narrative-closing-band" aria-label="产品背景总结">
        <p>从一句话开始，而不是从一张表单开始。</p>
        <span>这就是 Lonely FM 的产品背景。</span>
      </section>
    </main>
  </div>
);

const TechnologyPage = () => (
  <div className="info-shell narrative-shell">
    <MarketingNav />
    <main className="narrative-main">
      <section className="narrative-hero">
        <div>
          <p className="section-eyebrow">Technology</p>
          <h1>
            <span>本地 Gemma 4 优先，</span>
            <span>云端能力可选。</span>
          </h1>
        </div>
        <p>
          技术路线以可获得性、隐私和演示稳定性为核心：能在用户自己的电脑上运行，就优先使用本地 Gemma 4；需要移动设备或更方便测试时，再提供云端 API 选项。
        </p>
      </section>

      <section className="technology-stack" aria-label="技术路线">
        {TECHNOLOGY_STEPS.map((step, index) => {
          const Icon = step.icon;
          return (
            <article className="technology-step" key={step.title}>
              <span className="technology-step-index">{String(index + 1).padStart(2, "0")}</span>
              <Icon size={24} />
              <h2>{step.title}</h2>
              <p>{step.body}</p>
            </article>
          );
        })}
      </section>

      <section className="technology-architecture" aria-label="技术架构">
        <div className="technology-node">
          <span>Client</span>
          <strong>浏览器实时语音</strong>
          <p>麦克风、VAD、连接状态</p>
        </div>
        <ArrowRight className="technology-arrow" size={22} />
        <div className="technology-node">
          <span>Gemma 4</span>
          <strong>本地优先 / 云端补充</strong>
          <p>Ollama 或用户自己的 API key</p>
        </div>
        <ArrowRight className="technology-arrow" size={22} />
        <div className="technology-node">
          <span>Memory</span>
          <strong>可删除的长期记忆</strong>
          <p>按账号隔离，访客不保存</p>
        </div>
      </section>
    </main>
  </div>
);

const TEAM_MEMBERS = [
  {
    name: "Johnny Wang",
    role: "产品方向 / 体验设计 / 演示叙事",
    body: "把 Lonely FM 的定位、交互、视觉和评审表达串起来，让它不是一个临时 Demo，而是一个能被理解、能被试用、也能被记住的 AI for Good 产品。",
    focus: ["语音陪伴产品定义", "极简交互与视觉系统", "黑客松演示叙事"]
  },
  {
    name: "Tim Tsui",
    role: "技术协作 / 模型验证 / 本地部署",
    body: "负责协作验证 Gemma 4、本地 Ollama 使用路径和真实测试流程，确保队友、评委和不同设备上的体验尽可能稳定、清楚、可复现。",
    focus: ["Gemma 4 本地测试", "部署与使用路径", "跨设备测试反馈"]
  }
];

const TeamPage = () => (
  <div className="info-shell team-shell">
    <MarketingNav />
    <main className="team-page-main">
      <section className="team-page-hero">
        <div>
          <p className="section-eyebrow">Team</p>
          <h1>
            <span>两个人，把孤独时刻</span>
            <span>做成一通可接起的声音。</span>
          </h1>
        </div>
        <div className="team-page-lead">
          <p>
            Lonely FM 由 Johnny Wang 和 Tim Tsui 共同完成。我们把产品、设计、模型、语音和演示串成一个可被真实使用的作品。
          </p>
          <div className="team-page-meta" aria-label="团队关键词">
            <span>AI for Good</span>
            <span>Gemma 4</span>
            <span>Voice first</span>
          </div>
        </div>
      </section>

      <section className="team-member-grid" aria-label="团队成员">
        {TEAM_MEMBERS.map((member, index) => (
          <article className="team-member-panel" key={member.name}>
            <div className="team-member-header">
              <span className="team-member-index">{String(index + 1).padStart(2, "0")}</span>
              <div>
                <h2>{member.name}</h2>
                <p className="team-member-role">{member.role}</p>
              </div>
            </div>
            <p className="team-member-body">{member.body}</p>
            <div className="team-member-focus" aria-label={`${member.name} 负责方向`}>
              {member.focus.map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>
          </article>
        ))}
      </section>

      <section className="team-goal-band" aria-label="共同目标">
        <div className="team-goal-label">
          <Users size={22} />
          <span>共同目标</span>
        </div>
        <p>
          用 Gemma 4 做一个真正面向孤独人群的陪伴工具：可访问、可持续、尊重隐私，也尊重人的情绪。评委看到的是技术路线，用户感受到的是有人认真听。
        </p>
      </section>
    </main>
  </div>
);

const HERO_LINE = "你好。先别急着说得完整 —— 挑最想说的那一句就好。今晚，想从哪里开始？";

const HomePage = () => {
  const [chipsIn, setChipsIn] = useState(false);
  const intro = useTypewriter(HERO_LINE);
  const heroRef = useRef<HTMLElement>(null);
  const authProfile = useSessionStore((state) => state.authProfile);
  const logout = useSessionStore((state) => state.logout);

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

  const handleLoadedMetadata = (e: React.SyntheticEvent<HTMLVideoElement>) => {
    const video = e.currentTarget;
    targetTimeRef.current = video.currentTime;
  };

  return (
    <div className="home-shell">
      <MarketingNav />

      <main>
        <section className="home-hero" aria-labelledby="home-title" ref={heroRef}>
          <div className="hero-bg" aria-hidden="true">
            <div className="hero-bg-art" />
            <video
              ref={videoRef}
              src="/companion.mp4"
              muted
              playsInline
              preload="auto"
              onLoadedMetadata={handleLoadedMetadata}
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
          <article className="principle-card">
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
        setGemmaConnection(createLocalGemmaConnection(result.selectedModel, result.ollamaBaseUrl));
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

  const localStatusText = checking
    ? "正在检测这台电脑是否已经启动本地后端和 Ollama..."
    : localResult?.ok
      ? `已检测到 ${localResult.selectedModel ?? "本地 Gemma 4"}，可以进入频道。`
      : localResult?.modelAvailable && !localResult.backendAvailable
        ? `已检测到 ${localResult.selectedModel ?? "本地 Gemma 4"}，还需要启动 Lonely FM 本地后端。`
        : localResult?.ollamaAvailable
          ? "Ollama 已启动，但没有找到可用的 Gemma 4。"
          : "没有检测到可用的本地 Gemma 4。";

  return (
    <div className="setup-shell">
      <header className="setup-header">
        <Link className="home-logo-link" to="/" aria-label="Lonely FM">
          <Logo />
        </Link>
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
                <p>{localStatusText}</p>
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
                  <span>2. 安装或确认本地 Gemma 4 模型。</span>
                  <span>3. 启动 Lonely FM 本地后端。</span>
                  <span>4. 回到这里重新检测。</span>
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
                {localResult.modelAvailable && !localResult.backendAvailable && (
                  <p className="setup-hint">Gemma 模型已经在这台电脑上了；现在只差本地后端把网页和 Ollama 串起来。</p>
                )}
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
        <Link className="home-logo-link" to="/" aria-label="返回 Lonely FM 首页"><Logo /></Link>
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
      <Route path="/background" element={<BackgroundPage />} />
      <Route path="/technology" element={<TechnologyPage />} />
      <Route path="/team" element={<TeamPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/setup" element={<GemmaSetupPage />} />
      <Route path="/voice-select" element={<VoiceSelectPage />} />
      <Route path="/talk" element={<TalkPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
};

export default App;

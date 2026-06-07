import type { GemmaConnection } from "../types";

export const RECOMMENDED_LOCAL_GEMMA_MODEL = "gemma4:12b-mlx";
export const LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const LOCAL_BACKEND_LABEL = "Lonely FM 本地后端";
const LOCAL_HOSTS = ["127.0.0.1", "localhost"];

export interface LocalGemmaCheck {
  ok: boolean;
  backendAvailable: boolean;
  ollamaAvailable: boolean;
  modelAvailable: boolean;
  models: string[];
  selectedModel?: string;
  backendUrl?: string;
  ollamaBaseUrl?: string;
  error?: string;
  setupHint?: string;
}

const normalizeModelName = (value: string) => value.trim().toLowerCase();

const isGemma4Model = (value: string) => {
  const normalized = normalizeModelName(value);
  return normalized === "gemma4" || normalized.startsWith("gemma4:");
};

const checkLocalBackendGemma = async (signal: AbortSignal): Promise<LocalGemmaCheck | null> => {
  const ports = [8001, 8000];

  for (const host of LOCAL_HOSTS) {
    for (const port of ports) {
      try {
        const backendUrl = `http://${host}:${port}`;
        const response = await fetch(`${backendUrl}/api/gemma/status`, {
          cache: "no-store",
          signal
        });
        if (!response.ok) continue;

        const data = (await response.json()) as {
          available?: boolean;
          model?: string;
          selected_model?: string;
          base_url?: string;
          models?: string[];
          error?: string;
        };
        const models = Array.isArray(data.models) ? data.models.filter(Boolean) : [];
        const selectedModel = data.selected_model || models.find(isGemma4Model) || data.model;
        const modelAvailable = Boolean(data.available && selectedModel && isGemma4Model(selectedModel));

        if (typeof window !== "undefined") {
          localStorage.setItem("LONELY_FM_LOCAL_PORT", String(port));
          localStorage.setItem("LONELY_FM_LOCAL_HOST", host);
        }

        return {
          ok: modelAvailable,
          backendAvailable: true,
          ollamaAvailable: true,
          modelAvailable,
          selectedModel,
          models,
          backendUrl,
          ollamaBaseUrl: data.base_url,
          error: modelAvailable ? undefined : data.error || "本地后端没有检测到 Gemma 4 模型",
          setupHint: modelAvailable
            ? undefined
            : "请确认 Ollama 已启动，并安装 gemma4:e4b、gemma4:12b-mlx 或 gemma4:21b 中任意一个。"
        };
      } catch {
        // Ignore and try next combination
      }
    }
  }
  return null;
};

const withTimeout = async <Result,>(
  action: (signal: AbortSignal) => Promise<Result>,
  timeoutMs = 4000
): Promise<Result> => {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await action(controller.signal);
  } finally {
    window.clearTimeout(timeout);
  }
};

const checkLocalOllamaAt = async (baseUrl: string, signal: AbortSignal): Promise<LocalGemmaCheck> => {
  const response = await fetch(`${baseUrl}/api/tags`, {
    cache: "no-store",
    signal
  });
  if (!response.ok) {
    return {
      ok: false,
      backendAvailable: false,
      ollamaAvailable: true,
      modelAvailable: false,
      models: [],
      ollamaBaseUrl: baseUrl,
      error: `Ollama 返回 ${response.status}`
    };
  }
  const data = (await response.json()) as { models?: Array<{ name?: string; model?: string }> };
  const models = (data.models ?? [])
    .map((model) => model.name || model.model || "")
    .filter(Boolean);
  const selectedModel = models.find(isGemma4Model);
  const modelAvailable = Boolean(selectedModel);
  return {
    ok: false,
    backendAvailable: false,
    ollamaAvailable: true,
    modelAvailable,
    selectedModel,
    models,
    ollamaBaseUrl: baseUrl,
    error: modelAvailable ? undefined : "没有找到 Gemma 4 模型",
    setupHint: modelAvailable
      ? undefined
      : "如果你已经装了 Gemma 4，请确认模型名称以 gemma4 开头，例如 gemma4:e4b、gemma4:12b-mlx 或 gemma4:21b。"
  };
};

export const checkLocalGemma = async (): Promise<LocalGemmaCheck> => {
  const isSecurePage = typeof window !== "undefined" && window.location.protocol === "https:";
  try {
    const backendResult = await withTimeout((signal) => checkLocalBackendGemma(signal));
    if (backendResult?.ok) {
      return backendResult;
    }

    const ollamaResult = await checkLocalOllamaOnly();
    if (backendResult?.backendAvailable && ollamaResult.modelAvailable) {
      return {
        ...backendResult,
        ok: true,
        ollamaAvailable: true,
        modelAvailable: true,
        selectedModel: ollamaResult.selectedModel,
        models: ollamaResult.models,
        ollamaBaseUrl: ollamaResult.ollamaBaseUrl,
        error: undefined,
        setupHint: undefined
      };
    }

    if (ollamaResult.modelAvailable && !backendResult?.backendAvailable) {
      return {
        ...ollamaResult,
        ok: false,
        error: "已检测到本地 Gemma 4，但还没有连接到 Lonely FM 本地后端",
        setupHint: "请启动 Lonely FM 本地后端（8001 或 8000 端口），它会负责把语音聊天请求转给 Ollama / Gemma 4。"
      };
    }

    if (backendResult) {
      return backendResult;
    }

    return {
      ok: false,
      backendAvailable: false,
      ollamaAvailable: false,
      modelAvailable: false,
      models: [],
      error: isSecurePage ? "由于浏览器安全限制，无法连接本地后端" : "没有连接到 Lonely FM 本地后端",
      setupHint: isSecurePage
        ? "这是因为线上加密页面（HTTPS）无法直接请求本地服务（HTTP）。请确认本地后端（8001端口）已启动，并在 Chrome 地址栏左侧点击“控制/锁头”图标 -> 进入“网站设置 (Site settings)” -> 找到“不安全内容 (Insecure content)”并选择“允许 (Allow)”，刷新页面即可成功连接！"
        : "请先在这台电脑上启动 Lonely FM 本地后端；它会负责连接 Ollama / Gemma 4。"
    };
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      backendAvailable: false,
      ollamaAvailable: false,
      modelAvailable: false,
      models: [],
      error: isTimeout
        ? "本地后端响应超时"
        : isSecurePage
          ? "由于浏览器安全限制，无法连接本地后端"
          : "无法连接 Lonely FM 本地后端",
      setupHint: isSecurePage
        ? "这是因为线上加密页面（HTTPS）无法直接请求本地服务（HTTP）。请确认本地后端（8001端口）已启动，并在 Chrome 地址栏左侧点击“控制/锁头”图标 -> 进入“网站设置 (Site settings)” -> 找到“不安全内容 (Insecure content)”并选择“允许 (Allow)”，刷新页面即可成功连接！"
        : "请确认 Lonely FM 本地后端已启动，并且 8001 端口可以访问。"
    };
  }
};

export const checkLocalOllamaOnly = async (): Promise<LocalGemmaCheck> => {
  const isSecurePage = typeof window !== "undefined" && window.location.protocol === "https:";
  try {
    for (const host of LOCAL_HOSTS) {
      try {
        const result = await withTimeout((signal) => checkLocalOllamaAt(`http://${host}:11434`, signal));
        if (result.ollamaAvailable) {
          return result;
        }
      } catch {
        // Ignore and try the next loopback host.
      }
    }
    return {
      ok: false,
      backendAvailable: false,
      ollamaAvailable: false,
      modelAvailable: false,
      models: [],
      error: isSecurePage ? "由于浏览器安全限制，无法直接连接 Ollama" : "无法连接 Ollama",
      setupHint: isSecurePage
        ? "请先运行 OLLAMA_ORIGINS 命令并重启 Ollama；如果已经启动 Lonely FM 本地后端，也可以直接让后端代为连接 Ollama。"
        : "请确认 Ollama 已启动，并且 11434 端口可以访问。"
    };
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    return {
      ok: false,
      backendAvailable: false,
      ollamaAvailable: false,
      modelAvailable: false,
      models: [],
      error: isTimeout
        ? "本地后端或 Ollama 响应超时"
        : isSecurePage
          ? "由于浏览器安全限制，无法连接本地服务"
          : "无法连接本地后端或 Ollama",
      setupHint: isSecurePage
        ? "这是因为线上加密页面（HTTPS）无法直接请求本地服务（HTTP/WS）。请确认本地后端（8001端口）已启动，并在 Chrome 地址栏左侧点击“控制/锁头”图标 -> 进入“网站设置 (Site settings)” -> 找到“不安全内容 (Insecure content)”并选择“允许 (Allow)”，刷新页面即可成功连接！"
        : "请确认 Lonely FM 本地后端已启动，并且 Ollama 的 11434 端口可以访问。"
    };
  }
};

export const createLocalGemmaConnection = (
  model = RECOMMENDED_LOCAL_GEMMA_MODEL,
  baseUrl = LOCAL_OLLAMA_BASE_URL
): GemmaConnection => ({
  mode: "local",
  ready: true,
  model,
  baseUrl,
  checkedAt: new Date().toISOString()
});

export const createCloudGemmaConnection = (apiKey: string): GemmaConnection => ({
  mode: "cloud",
  ready: true,
  model: "gemma-4",
  apiKey,
  checkedAt: new Date().toISOString()
});

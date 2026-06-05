import type { GemmaConnection } from "../types";

export const LOCAL_GEMMA_MODEL = "gemma4:12b-mlx";
export const LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export interface LocalGemmaCheck {
  ok: boolean;
  ollamaAvailable: boolean;
  modelAvailable: boolean;
  models: string[];
  selectedModel?: string;
  error?: string;
  setupHint?: string;
}

const normalizeModelName = (value: string) => value.trim().toLowerCase();

const isGemma4Model = (value: string) => {
  const normalized = normalizeModelName(value);
  return normalized === "gemma4" || normalized.startsWith("gemma4:");
};

export const checkLocalGemma = async (): Promise<LocalGemmaCheck> => {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    const response = await fetch(`${LOCAL_OLLAMA_BASE_URL}/api/tags`, {
      cache: "no-store",
      signal: controller.signal
    });
    window.clearTimeout(timeout);
    if (!response.ok) {
      return {
        ok: false,
        ollamaAvailable: true,
        modelAvailable: false,
        models: [],
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
      ok: modelAvailable,
      ollamaAvailable: true,
      modelAvailable,
      selectedModel,
      models,
      error: modelAvailable ? undefined : "没有找到 Gemma 4 模型",
      setupHint: modelAvailable
        ? undefined
        : "如果你已经装了 Gemma 4，请确认模型名称以 gemma4 开头，例如 gemma4:12b-mlx、gemma4:e4b 或 gemma4:21b。"
    };
  } catch (error) {
    const isTimeout = error instanceof DOMException && error.name === "AbortError";
    const isSecurePage = typeof window !== "undefined" && window.location.protocol === "https:";
    return {
      ok: false,
      ollamaAvailable: false,
      modelAvailable: false,
      models: [],
      error: isTimeout
        ? "本机 Ollama 响应超时"
        : isSecurePage
          ? "线上页面没有权限连接本机 Ollama"
          : "无法连接本机 Ollama",
      setupHint: isSecurePage
        ? "请先允许 Ollama 接受 lonely-fm.vercel.app 的浏览器请求，然后退出并重新打开 Ollama。"
        : "请确认 Ollama 已经启动，并且本机 11434 端口可以访问。"
    };
  }
};

export const createLocalGemmaConnection = (model = LOCAL_GEMMA_MODEL): GemmaConnection => ({
  mode: "local",
  ready: true,
  model,
  baseUrl: LOCAL_OLLAMA_BASE_URL,
  checkedAt: new Date().toISOString()
});

export const createCloudGemmaConnection = (apiKey: string): GemmaConnection => ({
  mode: "cloud",
  ready: true,
  model: "gemma-4",
  apiKey,
  checkedAt: new Date().toISOString()
});

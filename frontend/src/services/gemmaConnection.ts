import type { GemmaConnection } from "../types";
import { getApiUrl } from "./backend";

export const RECOMMENDED_LOCAL_GEMMA_MODEL = "gemma4:12b-mlx";
export const LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const LOCAL_BACKEND_LABEL = "Lonely FM 本地后端";

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

const checkLocalBackendGemma = async (signal: AbortSignal): Promise<LocalGemmaCheck | null> => {
  try {
    const response = await fetch(getApiUrl("/api/gemma/status"), {
      cache: "no-store",
      signal
    });
    if (!response.ok) {
      return {
        ok: false,
        ollamaAvailable: false,
        modelAvailable: false,
        models: [],
        error: `${LOCAL_BACKEND_LABEL} 返回 ${response.status}`,
        setupHint: "请先启动 Lonely FM 本地后端，再重新检测。"
      };
    }
    const data = (await response.json()) as {
      available?: boolean;
      model?: string;
      selected_model?: string;
      models?: string[];
      error?: string;
    };
    const models = Array.isArray(data.models) ? data.models.filter(Boolean) : [];
    const selectedModel = data.selected_model || models.find(isGemma4Model) || data.model;
    const modelAvailable = Boolean(data.available && selectedModel && isGemma4Model(selectedModel));
    return {
      ok: modelAvailable,
      ollamaAvailable: true,
      modelAvailable,
      selectedModel,
      models,
      error: modelAvailable ? undefined : data.error || "本地后端没有检测到 Gemma 4 模型",
      setupHint: modelAvailable
        ? undefined
        : "请确认 Ollama 已启动，并安装 gemma4:e4b、gemma4:12b-mlx 或 gemma4:21b 中任意一个。"
    };
  } catch {
    return null;
  }
};

export const checkLocalGemma = async (): Promise<LocalGemmaCheck> => {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 4000);
    const backendResult = await checkLocalBackendGemma(controller.signal);
    window.clearTimeout(timeout);
    if (backendResult) {
      return backendResult;
    }
    return {
      ok: false,
      ollamaAvailable: false,
      modelAvailable: false,
      models: [],
      error: "没有连接到 Lonely FM 本地后端",
      setupHint: "请先在这台电脑上启动 Lonely FM 本地后端；它会负责连接 Ollama / Gemma 4。"
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
        ? "本地后端响应超时"
        : isSecurePage
          ? "线上页面暂时连不上这台电脑的本地后端"
          : "无法连接 Lonely FM 本地后端",
      setupHint: isSecurePage
        ? "请先启动 Lonely FM 本地后端和 Ollama；如果仍失败，再使用云端 Gemma 4 API。"
        : "请确认 Lonely FM 本地后端已启动，并且 8001 端口可以访问。"
    };
  }
};

export const checkLocalOllamaOnly = async (): Promise<LocalGemmaCheck> => {
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
        : "如果你已经装了 Gemma 4，请确认模型名称以 gemma4 开头，例如 gemma4:e4b、gemma4:12b-mlx 或 gemma4:21b。"
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
        ? "本地后端或 Ollama 响应超时"
        : isSecurePage
          ? "线上页面暂时连不上这台电脑的本地服务"
          : "无法连接本地后端或 Ollama",
      setupHint: isSecurePage
        ? "请先启动 Lonely FM 本地后端和 Ollama；如果仍失败，再使用云端 Gemma 4 API。"
        : "请确认 Lonely FM 本地后端已启动，并且 Ollama 的 11434 端口可以访问。"
    };
  }
};

export const createLocalGemmaConnection = (model = RECOMMENDED_LOCAL_GEMMA_MODEL): GemmaConnection => ({
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

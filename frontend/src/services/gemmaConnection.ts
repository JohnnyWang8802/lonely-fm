import type { GemmaConnection } from "../types";

export const LOCAL_GEMMA_MODEL = "gemma4:12b-mlx";
export const LOCAL_OLLAMA_BASE_URL = "http://127.0.0.1:11434";

export interface LocalGemmaCheck {
  ok: boolean;
  ollamaAvailable: boolean;
  modelAvailable: boolean;
  models: string[];
  error?: string;
}

const normalizeModelName = (value: string) => value.trim().toLowerCase();

export const checkLocalGemma = async (): Promise<LocalGemmaCheck> => {
  try {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 2400);
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
    const normalizedTarget = normalizeModelName(LOCAL_GEMMA_MODEL);
    const modelAvailable = models.some((model) => normalizeModelName(model) === normalizedTarget);
    return {
      ok: modelAvailable,
      ollamaAvailable: true,
      modelAvailable,
      models,
      error: modelAvailable ? undefined : "没有找到 Gemma 4 12B MLX 模型"
    };
  } catch (error) {
    return {
      ok: false,
      ollamaAvailable: false,
      modelAvailable: false,
      models: [],
      error: error instanceof DOMException && error.name === "AbortError"
        ? "本机 Ollama 响应超时"
        : "无法连接本机 Ollama"
    };
  }
};

export const createLocalGemmaConnection = (): GemmaConnection => ({
  mode: "local",
  ready: true,
  model: LOCAL_GEMMA_MODEL,
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

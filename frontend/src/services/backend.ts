const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const LOCAL_BACKEND_HTTP_BASE = "http://127.0.0.1:8001";
const LOCAL_BACKEND_WS_BASE = "ws://127.0.0.1:8001";

export const getApiUrl = (path: string): string => {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return `${trimTrailingSlash(base || LOCAL_BACKEND_HTTP_BASE)}${cleanPath}`;
};

export const getWsUrl = (path: string): string => {
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  const configuredBase = import.meta.env.VITE_WS_BASE_URL as string | undefined;
  if (configuredBase) return `${trimTrailingSlash(configuredBase)}${cleanPath}`;

  const apiBase = import.meta.env.VITE_API_BASE_URL as string | undefined;
  if (apiBase) {
    const url = new URL(apiBase);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    return `${trimTrailingSlash(url.toString())}${cleanPath}`;
  }

  return `${LOCAL_BACKEND_WS_BASE}${cleanPath}`;
};

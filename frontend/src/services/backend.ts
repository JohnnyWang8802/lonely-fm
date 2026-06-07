const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getLocalPort = (): string => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("LONELY_FM_LOCAL_PORT") || "8001";
  }
  return "8001";
};

export const getApiUrl = (path: string): string => {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (base) return `${trimTrailingSlash(base)}${cleanPath}`;
  
  const port = getLocalPort();
  return `http://127.0.0.1:${port}${cleanPath}`;
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

  const port = getLocalPort();
  return `ws://127.0.0.1:${port}${cleanPath}`;
};

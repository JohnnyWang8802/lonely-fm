const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

const getLocalPort = (): string => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("LONELY_FM_LOCAL_PORT") || "8001";
  }
  return "8001";
};

const getLocalHost = (): string => {
  if (typeof window !== "undefined") {
    return localStorage.getItem("LONELY_FM_LOCAL_HOST") || "127.0.0.1";
  }
  return "127.0.0.1";
};

export const getApiUrl = (path: string): string => {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (base) return `${trimTrailingSlash(base)}${cleanPath}`;
  
  const host = getLocalHost();
  const port = getLocalPort();
  return `http://${host}:${port}${cleanPath}`;
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

  const host = getLocalHost();
  const port = getLocalPort();
  return `ws://${host}:${port}${cleanPath}`;
};

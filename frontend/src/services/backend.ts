const trimTrailingSlash = (value: string) => value.replace(/\/+$/, "");

export const getApiUrl = (path: string): string => {
  const base = import.meta.env.VITE_API_BASE_URL as string | undefined;
  const cleanPath = path.startsWith("/") ? path : `/${path}`;
  return base ? `${trimTrailingSlash(base)}${cleanPath}` : cleanPath;
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

  const protocol = window.location.protocol === "https:" ? "wss" : "ws";
  return `${protocol}://${window.location.host}${cleanPath}`;
};

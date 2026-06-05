import { useEffect, useState } from "react";
import { getApiUrl } from "../services/backend";
import type { SystemStatus } from "../types";

export const useSystemStatus = () => {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const load = async () => {
      try {
        const response = await fetch(getApiUrl("/api/health"), { cache: "no-store" });
        if (!response.ok) throw new Error("health failed");
        const data = (await response.json()) as SystemStatus;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) setStatus(null);
      } finally {
        if (!cancelled) timer = window.setTimeout(load, 30000);
      }
    };
    void load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  return status;
};

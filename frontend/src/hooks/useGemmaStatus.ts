import { useEffect, useState } from "react";
import { getApiUrl } from "../services/backend";
import type { GemmaStatus } from "../types";

export const useGemmaStatus = () => {
  const [status, setStatus] = useState<GemmaStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | null = null;
    const load = async () => {
      try {
        const response = await fetch(getApiUrl("/api/gemma/status"), { cache: "no-store" });
        if (!response.ok) throw new Error("status failed");
        const data = (await response.json()) as GemmaStatus;
        if (!cancelled) setStatus(data);
      } catch {
        if (!cancelled) {
          setStatus({
            provider: "local",
            model: "gemma4",
            available: false,
            error: "status unavailable"
          });
        }
      } finally {
        if (!cancelled) {
          timer = window.setTimeout(load, 30000);
        }
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

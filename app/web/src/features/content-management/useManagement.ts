import { useCallback, useEffect, useRef, useState } from "react";
import { startContentSync, stopContentSync } from "./background-sync.mjs";
import { requestApi, sendApi } from "./api";
import type { ManagementSession } from "./types";

export function useManagement() {
  const [session, setSession] = useState<ManagementSession>({ state: "checking" });
  const mounted = useRef(false);
  const pending = useRef<Promise<void> | null>(null);
  const controller = useRef<AbortController | null>(null);
  const loggingOut = useRef(false);
  const generation = useRef(0);
  const lastCheck = useRef(0);

  const refresh = useCallback((): Promise<void> => {
    if (loggingOut.current) return Promise.resolve();
    if (pending.current) return pending.current;
    const current = generation.current;
    const requestController = new AbortController();
    controller.current = requestController;
    const deadline = setTimeout(() => requestController.abort(), 30000);
    lastCheck.current = Date.now();
    const checking = (async () => {
      // One deadline covers both attempts, including response body reads.
      const signal = requestController.signal;
      for (let attempt = 0; attempt < 2; attempt++) {
        if (generation.current !== current) return;
        try {
          const next = await requestApi<ManagementSession & { retryable?: boolean }>("/api/session", { signal });
          if (!["signed_out", "ready", "blocked"].includes(next.state)) throw new Error("Invalid session response");
          if (next.state === "blocked" && next.retryable && attempt === 0) {
            await new Promise(resolve => setTimeout(resolve, 250));
            continue;
          }
          if (mounted.current && generation.current === current) setSession(next);
          return;
        } catch (error) {
          const status = error instanceof Error && "status" in error ? Number(error.status) : 0;
          if (attempt === 0 && !signal.aborted && (!status || status >= 500)) {
            await new Promise(resolve => setTimeout(resolve, 250));
            continue;
          }
          if (mounted.current && generation.current === current) {
            setSession({ state: "blocked", error: "GitHub 연결을 확인하지 못했습니다. 연결을 다시 확인하십시오." });
          }
          return;
        }
      }
    })();
    pending.current = checking;
    void checking.finally(() => {
      clearTimeout(deadline);
      if (pending.current === checking) pending.current = null;
      if (controller.current === requestController) controller.current = null;
    });
    return checking;
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    function recheck() {
      if (document.visibilityState === "hidden" || Date.now() - lastCheck.current < 5000) return;
      void refresh();
    }
    window.addEventListener("online", recheck);
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      mounted.current = false;
      window.removeEventListener("online", recheck);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
      // StrictMode immediately mounts again; real unmounts cancel the owned request.
      queueMicrotask(() => {
        if (!mounted.current) controller.current?.abort();
      });
    };
  }, [refresh]);

  useEffect(() => {
    if (session.state === "ready") startContentSync(session);
    else stopContentSync();
    return stopContentSync;
  }, [session.state, session.csrfToken]);

  async function logout() {
    if (loggingOut.current) return;
    loggingOut.current = true;
    generation.current++;
    try {
      await sendApi("/api/logout", {}, session.csrfToken ?? "");
      setSession({ state: "signed_out" });
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 401) {
        setSession({ state: "signed_out" });
        return;
      }
      setSession((current) => ({
        ...current,
        error: error instanceof Error ? error.message : "로그아웃하지 못했습니다. 다시 시도하십시오.",
      }));
    } finally {
      loggingOut.current = false;
    }
  }

  return { session, refresh, logout };
}

export type Management = ReturnType<typeof useManagement>;

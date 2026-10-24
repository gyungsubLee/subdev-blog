import { useCallback, useEffect, useState } from "react";
import { requestApi, sendApi } from "./api";
import type { ManagementSession } from "./types";

export function useManagement() {
  const [session, setSession] = useState<ManagementSession>({ state: "checking" });

  const refresh = useCallback(async () => {
    try {
      const next = await requestApi<ManagementSession>("/api/session");
      if (!["signed_out", "ready", "blocked"].includes(next.state)) throw new Error("Invalid session response");
      setSession(next);
    } catch {
      setSession({ state: "blocked", error: "GitHub 연결을 확인하지 못했습니다. 연결을 다시 확인하십시오." });
    }
  }, []);

  useEffect(() => {
    let active = true;
    requestApi<ManagementSession>("/api/session")
      .then((next) => {
        if (!active) return;
        if (!["signed_out", "ready", "blocked"].includes(next.state)) throw new Error("Invalid session response");
        setSession(next);
      })
      .catch(() => {
        if (active) setSession({ state: "blocked", error: "GitHub 연결을 확인하지 못했습니다. 연결을 다시 확인하십시오." });
      });
    return () => { active = false; };
  }, []);

  async function logout() {
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
    }
  }

  return { session, refresh, logout };
}

export type Management = ReturnType<typeof useManagement>;

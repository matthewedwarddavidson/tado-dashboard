import { useState, useEffect, useCallback } from "react";
import { api } from "../api";
import type { AuthStatus } from "../api";

interface Props {
  onAuthenticated: () => void;
}

export function AuthPage({ onAuthenticated }: Props) {
  const [phase, setPhase] = useState<"idle" | "pending" | "error">("idle");
  const [verificationUri, setVerificationUri] = useState<string | null>(null);
  const [userCode, setUserCode] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Poll for auth completion while pending
  useEffect(() => {
    if (phase !== "pending") return;
    const id = setInterval(async () => {
      try {
        const data = await api.getAuthStatus();
        if (data.status === "authenticated") {
          clearInterval(id);
          window.location.reload();
        }
      } catch {
        // Keep polling — network blip
      }
    }, 2000);
    return () => clearInterval(id);
  }, [phase]);

  const handleConnect = useCallback(async () => {
    setErrorMsg(null);
    try {
      const data: AuthStatus = await api.startAuth();
      if (data.status === "authenticated") {
        window.location.reload();
      } else if (data.status === "pending" && data.verificationUri) {
        setVerificationUri(data.verificationUri);
        setUserCode(data.userCode ?? null);
        setPhase("pending");
        window.open(data.verificationUri, "_blank", "noreferrer");
      }
    } catch {
      setErrorMsg("Failed to start authentication. Is the backend running?");
      setPhase("error");
    }
  }, [onAuthenticated]);

  return (
    <div className="min-h-screen bg-gray-100 flex items-center justify-center p-6">
      <div className="bg-white rounded-2xl shadow-lg p-10 max-w-md w-full text-center">
        <h1 className="text-2xl font-bold text-gray-800 mb-1">tado° Dashboard</h1>
        <p className="text-gray-400 text-sm mb-8">Connect your tado° account to get started</p>

        {phase === "idle" && (
          <button
            onClick={handleConnect}
            className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-8 py-3 rounded-xl transition-colors cursor-pointer"
          >
            Connect tado°
          </button>
        )}

        {phase === "pending" && (
          <div className="space-y-5">
            <p className="text-sm text-gray-500">
              A tado° login page has opened in a new tab.
              <br />Sign in there to authorise this dashboard.
            </p>

            {userCode && (
              <div className="bg-gray-50 border border-gray-100 rounded-xl p-4">
                <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Confirmation code</p>
                <p className="text-3xl font-mono font-bold text-gray-800 tracking-widest">{userCode}</p>
              </div>
            )}

            {verificationUri && (
              <a
                href={verificationUri}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-blue-500 hover:underline"
              >
                Open tado° login page again ↗
              </a>
            )}

            <div className="flex items-center justify-center gap-2 text-sm text-gray-400 pt-2">
              <div className="w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
              Waiting for authorisation…
            </div>
          </div>
        )}

        {phase === "error" && (
          <div className="space-y-4">
            <p className="text-red-500 text-sm">{errorMsg}</p>
            <button
              onClick={() => { setPhase("idle"); }}
              className="text-sm text-blue-500 hover:underline"
            >
              Try again
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

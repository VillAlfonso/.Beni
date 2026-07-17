import React, { useState } from "react";
import { useStore } from "../store.js";

export function LoginGate() {
  const { actions } = useStore();
  const [key, setKey] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await actions.login(key);
    } catch {
      setErr("That key didn't work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="gate">
      <div className="gate-card">
        <img src="/logo.png" alt="Beni" />
        <h1>Beni</h1>
        <form onSubmit={submit}>
          <input
            type="password"
            placeholder="access key"
            value={key}
            onChange={(e) => setKey(e.target.value)}
            autoFocus
          />
          <button className="btn solid" disabled={busy || !key}>
            Enter
          </button>
          {err && <div className="err">{err}</div>}
        </form>
      </div>
    </div>
  );
}

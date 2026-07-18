import React, { useState } from "react";
import { useStore } from "../store.js";

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  const { actions } = useStore();
  return (
    <>
      <div className="scrim" onClick={() => actions.setPanel("none")} />
      <div className="panel" role="dialog" aria-label={title}>
        <div className="panel-head">
          <h2>{title}</h2>
          <button className="iconbtn" onClick={() => actions.setPanel("none")} aria-label="close">✕</button>
        </div>
        <div className="panel-body">{children}</div>
      </div>
    </>
  );
}

export function SettingsPanel() {
  const { state, actions } = useStore();
  const s = state.settings ?? {};
  const [f, setF] = useState<Record<string, string>>({
    "llm.baseUrl": s.llm?.baseUrl ?? "",
    "llm.apiKey": s.llm?.apiKey ?? "",
    "llm.model": s.llm?.model ?? "",
    "gen.temperature": String(s.gen?.temperature ?? 0.85),
    "gen.maxTokens": String(s.gen?.maxTokens ?? 420),
    "gen.topP": String(s.gen?.topP ?? 0.95),
    "utility.baseUrl": s.utility?.baseUrl ?? "",
    "utility.apiKey": s.utility?.apiKey ?? "",
    "utility.model": s.utility?.model ?? "",
    userName: s.userName ?? "",
    userLooks: s.userLooks ?? "",
    accessKey: ""
  });
  const [saved, setSaved] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  const save = async () => {
    const payload: Record<string, string> = { ...f };
    if (!payload.accessKey) delete (payload as any).accessKey;
    await actions.saveSettings(payload);
    setSaved(true);
    setTimeout(() => setSaved(false), 1600);
  };

  return (
    <Panel title="Settings">
      <div className="field">
        <label>Model endpoint (OpenAI-compatible)</label>
        <input value={f["llm.baseUrl"]} onChange={set("llm.baseUrl")} placeholder="http://127.0.0.1:5001/v1" />
        <span className="hint">
          KoboldCpp: http://127.0.0.1:5001/v1 · LM Studio: http://127.0.0.1:1234/v1 · OpenRouter:
          https://openrouter.ai/api/v1 · or "mock" to test without a model. See docs/MODELS.md.
        </span>
      </div>
      <div className="row2">
        <div className="field">
          <label>Model name</label>
          <input value={f["llm.model"]} onChange={set("llm.model")} placeholder="local" />
        </div>
        <div className="field">
          <label>API key</label>
          <input value={f["llm.apiKey"]} onChange={set("llm.apiKey")} placeholder="(none for local)" />
        </div>
      </div>
      <div className="row3">
        <div className="field">
          <label>Temp</label>
          <input value={f["gen.temperature"]} onChange={set("gen.temperature")} inputMode="decimal" />
        </div>
        <div className="field">
          <label>Max tokens</label>
          <input value={f["gen.maxTokens"]} onChange={set("gen.maxTokens")} inputMode="numeric" />
        </div>
        <div className="field">
          <label>Top-p</label>
          <input value={f["gen.topP"]} onChange={set("gen.topP")} inputMode="decimal" />
        </div>
      </div>
      <div className="field">
        <label>Your name in the roleplay</label>
        <input value={f.userName} onChange={set("userName")} placeholder="what Beni's memories call you" />
      </div>
      <div className="field">
        <label>Your appearance (what she can see at a glance)</label>
        <input
          value={f.userLooks}
          onChange={set("userLooks")}
          placeholder="e.g. tall-ish teen guy, average looks, black hair, hoodie"
        />
      </div>
      <div className="field">
        <label>Access key {s.authEnabled ? "(enabled)" : "(off — set one before exposing the tunnel)"}</label>
        <input value={f.accessKey} onChange={set("accessKey")} type="password" placeholder="set new access key" />
      </div>

      <button className="btn quiet" onClick={() => setAdvanced(!advanced)}>
        {advanced ? "▾" : "▸"} Utility model (memory extraction)
      </button>
      {advanced && (
        <>
          <div className="field">
            <label>Utility endpoint</label>
            <input value={f["utility.baseUrl"]} onChange={set("utility.baseUrl")} placeholder="(defaults to main model)" />
          </div>
          <div className="row2">
            <div className="field">
              <label>Utility model</label>
              <input value={f["utility.model"]} onChange={set("utility.model")} />
            </div>
            <div className="field">
              <label>Utility API key</label>
              <input value={f["utility.apiKey"]} onChange={set("utility.apiKey")} />
            </div>
          </div>
        </>
      )}

      <button className="btn solid" onClick={() => void save()}>{saved ? "Saved" : "Save settings"}</button>
    </Panel>
  );
}

export function MemoriesPanel() {
  const { state, actions } = useStore();
  return (
    <Panel title="Her memories of this chat">
      {state.memories.length === 0 && (
        <p className="hint" style={{ color: "var(--ghost)", fontSize: 13 }}>
          Nothing yet. Memories distill automatically every few messages, and Beni recalls them in later scenes.
        </p>
      )}
      {state.memories.map((m) => (
        <div className="list-item" key={m.id}>
          <span className="li-text">{m.text}</span>
          <span className="li-meta">
            importance {m.importance} · {new Date(m.created_at).toLocaleString()}
          </span>
          <div className="li-actions">
            <button onClick={() => void actions.deleteMemory(m.id)}>forget</button>
          </div>
        </div>
      ))}
    </Panel>
  );
}

export function CheckpointsPanel() {
  const { state, actions } = useStore();
  const [name, setName] = useState("");
  return (
    <Panel title="Checkpoints">
      <div className="field">
        <label>Save the current point</label>
        <div style={{ display: "flex", gap: 8 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="checkpoint name" style={{ flex: 1 }} />
          <button
            className="btn solid"
            disabled={!name.trim()}
            onClick={() => {
              void actions.addCheckpoint(name.trim());
              setName("");
            }}
          >
            Save
          </button>
        </div>
        <span className="hint">Restoring moves the chat back to that message. Newer branches stay saved — flip forward again with ‹ › on the message.</span>
      </div>
      {state.checkpoints.map((c) => (
        <div className="list-item" key={c.id}>
          <span className="li-text">{c.name}</span>
          <span className="li-meta">{new Date(c.created_at).toLocaleString()}</span>
          <div className="li-actions">
            <button onClick={() => void actions.restoreCheckpoint(c.id)}>restore</button>
            <button onClick={() => void actions.deleteCheckpoint(c.id)}>delete</button>
          </div>
        </div>
      ))}
    </Panel>
  );
}

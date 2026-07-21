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

interface OocMsg { id: string; role: string; content: string; created_at: number }

export function OocPanel() {
  const { state } = useStore();
  const [msgs, setMsgs] = useState<OocMsg[]>([]);
  const [directives, setDirectives] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const chatId = state.activeId;

  const load = React.useCallback(async () => {
    if (!chatId) return;
    const r = await fetch(`/api/chats/${chatId}/ooc`);
    const d = await r.json();
    setMsgs(d.messages ?? []);
    setDirectives(d.directives ?? []);
  }, [chatId]);
  React.useEffect(() => { void load(); }, [load]);

  const send = async () => {
    const t = text.trim();
    if (!t || busy || !chatId) return;
    setBusy(true);
    setText("");
    setMsgs((m) => [...m, { id: "tmp", role: "user", content: t, created_at: Date.now() }]);
    try {
      const r = await fetch(`/api/chats/${chatId}/ooc`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: t })
      });
      const d = await r.json();
      if (d.reply !== undefined) {
        setMsgs((m) => [...m.filter((x) => x.id !== "tmp"), { id: `u${Date.now()}`, role: "user", content: t, created_at: Date.now() }, { id: `a${Date.now()}`, role: "assistant", content: d.reply, created_at: Date.now() }]);
        setDirectives(d.directives ?? []);
      }
    } finally {
      setBusy(false);
    }
  };

  const removeDirective = async (i: number) => {
    if (!chatId) return;
    const r = await fetch(`/api/chats/${chatId}/directives/${i}`, { method: "DELETE" });
    const d = await r.json();
    setDirectives(d.directives ?? []);
  };

  return (
    <Panel title="System channel (out of character)">
      <p className="hint" style={{ marginBottom: 10 }}>
        Talk to the system, not Beni — ask "was this really in the show?", or correct the
        roleplay ("Beni wouldn't do that"). Corrections become standing directives for this
        chat only.
      </p>
      {directives.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div className="hint" style={{ marginBottom: 4 }}>Active directives for this chat:</div>
          {directives.map((d, i) => (
            <div key={i} style={{ display: "flex", gap: 6, alignItems: "baseline", fontSize: 13, marginBottom: 3 }}>
              <span style={{ flex: 1 }}>• {d}</span>
              <button className="iconbtn" onClick={() => void removeDirective(i)} aria-label="remove">✕</button>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: "45vh", overflowY: "auto", marginBottom: 10 }}>
        {msgs.length === 0 && <span className="hint">Nothing yet. This channel is separate per chat.</span>}
        {msgs.map((m) => (
          <div key={m.id} style={{ fontSize: 13.5, opacity: m.role === "user" ? 1 : 0.85 }}>
            <strong>{m.role === "user" ? "You" : "System"}:</strong> {m.content}
          </div>
        ))}
        {busy && <span className="hint">system is thinking…</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input
          style={{ flex: 1, background: "transparent", border: "1px solid var(--line-strong)", borderRadius: 8, padding: "8px 10px" }}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
          placeholder='e.g. "Beni wouldn’t say that" or "was Eurus really a traitor?"'
          disabled={busy || !chatId}
        />
        <button className="btn solid" disabled={busy || !text.trim()} onClick={() => void send()}>Send</button>
      </div>
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

/**
 * Her log. No meters, no numbers, no bar — deliberately. Whatever she thinks of
 * you is only ever readable here, in her words, one night at a time.
 */
export function JournalPanel() {
  const { state, actions } = useStore();
  // newest day open, the rest folded away — the log gets long fast
  const [open, setOpen] = useState<string | null>(state.journal[0]?.id ?? null);
  const newest = state.journal[0]?.id;

  return (
    <Panel title="Her log">
      {state.journal.length === 0 && (
        <p className="hint" style={{ color: "var(--ghost)", fontSize: 13 }}>
          Nothing written yet. She closes a page at the end of each day — the next in-world day in
          story mode, the next real day otherwise. Or seal today now and see what she'd have put down.
        </p>
      )}
      {state.journal.map((j) => {
        const isOpen = open === j.id || (open === null && j.id === newest);
        return (
          <div className={`log-day${isOpen ? " open" : ""}`} key={j.id}>
            <button className="log-date" onClick={() => setOpen(isOpen ? "" : j.id)} aria-expanded={isOpen}>
              <span className="log-caret">{isOpen ? "▾" : "▸"}</span>
              {j.dayLabel}
            </button>
            {isOpen && (
              <div className="log-body">
                <div className="log-entry">
                  <p>{j.read}</p>
                </div>
                <div className="log-entry">
                  <span className="log-tag">what you're changing</span>
                  <p>{j.world}</p>
                </div>
              </div>
            )}
          </div>
        );
      })}
      <div style={{ marginTop: 14 }}>
        <button className="btn quiet" disabled={state.journalBusy} onClick={() => void actions.sealToday()}>
          {state.journalBusy ? "she's writing…" : "seal today"}
        </button>
      </div>
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

const GOAL_MARK: Record<string, string> = { pending: "○", done: "●", missed: "✕", abandoned: "–" };

/** The simulator's ledgers, spoilers fully visible — the director's view. */
export function TimelinePanel() {
  const { state } = useStore();
  const t = state.timeline;
  if (!t) {
    return (
      <Panel title="Timeline">
        <p className="hint">Reading the world state…</p>
      </Panel>
    );
  }

  const goals = t.goals ?? [];
  const beniGoals = goals.filter((g) => g.who === "Beni");
  const otherGoals = goals.filter((g) => g.who !== "Beni");

  return (
    <Panel title="Timeline">
      {t.cursor && (
        <p style={{ fontWeight: 500 }}>
          Day {t.cursor.day}, {t.cursor.timeOfDay}
          {t.episode ? <> · Ep {t.episode.no} "{t.episode.title}" (days {t.episode.days[0]}–{t.episode.days[1]})</> : <> · between episodes</>}
          {t.arc ? <> · {t.arc.label}</> : null}
        </p>
      )}
      {!t.covered && (
        <p className="hint">
          This chat's current episode has no timeline data yet — the engine is running in synopsis mode.
          Ledgers below reflect what is tracked.
        </p>
      )}
      {t.beni && <p className="hint">Beni right now: {t.beni}</p>}

      {beniGoals.length > 0 && (
        <div className="field">
          <label>Beni's missions</label>
          {beniGoals.map((g) => (
            <p key={g.id} style={{ margin: "4px 0" }}>
              <span title={g.status}>{GOAL_MARK[g.status] ?? "?"}</span> {g.text}
              {g.au ? <span className="hint"> · this timeline's own</span> : null}
              {g.status === "missed" ? <span className="hint"> · canon moment passed — still possible</span> : null}
              {g.note ? <span className="hint"> · {g.note}</span> : null}
            </p>
          ))}
        </div>
      )}

      {otherGoals.length > 0 && (
        <div className="field">
          <label>Everyone else's moves</label>
          {otherGoals.map((g) => (
            <p key={g.id} style={{ margin: "4px 0" }}>
              <span title={g.status}>{GOAL_MARK[g.status] ?? "?"}</span> <strong>{g.who}</strong> — {g.text}
              {g.au ? <span className="hint"> · adaptation</span> : null}
            </p>
          ))}
        </div>
      )}

      {(t.capabilities ?? []).length > 0 && (
        <div className="field">
          <label>Powers in play</label>
          {t.capabilities!.map((c) => (
            <p key={c.capability} style={{ margin: "4px 0" }}>
              {c.active ? "▲" : "▽"} {c.capability} — <span className="hint">{c.why}</span>
            </p>
          ))}
        </div>
      )}

      {(t.artifactCustody ?? []).length > 0 && (
        <div className="field">
          <label>Who holds what</label>
          {t.artifactCustody!.map((a) => (
            <p key={a.item} style={{ margin: "4px 0" }}>
              {a.name}: <strong>{a.holder}</strong>
              {a.overridden ? <span className="hint"> · DIVERGED from canon</span> : null}
            </p>
          ))}
        </div>
      )}

      <div className="field">
        <label>Divergence from canon</label>
        {(t.divergence ?? []).length === 0 ? (
          <p className="hint">None — this timeline still tracks the show.</p>
        ) : (
          t.divergence!.map((d, i) => (
            <p key={i} style={{ margin: "4px 0" }}>
              Day {d.day} <span className="hint">({d.level})</span>: {d.what}
              {d.effect ? <span className="hint"> → {d.effect}</span> : null}
            </p>
          ))
        )}
      </div>

      {(t.pressures ?? []).length > 0 && (
        <div className="field">
          <label>Watchers (0 calm → 3 acting on it)</label>
          <p style={{ margin: "4px 0" }}>
            {t.pressures!.map((p) => `${p.who} ${p.level}/3${p.note ? ` (${p.note})` : ""}`).join(" · ")}
          </p>
        </div>
      )}

      {(t.events ?? []).length > 0 && (
        <div className="field">
          <label>What has happened in this timeline</label>
          {t.events!.map((e, i) => (
            <p key={i} className="hint" style={{ margin: "3px 0" }}>— {e}</p>
          ))}
        </div>
      )}
    </Panel>
  );
}

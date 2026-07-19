import React, { useState } from "react";
import Markdown from "react-markdown";
import { useStore, type Msg } from "../store.js";

function Sibnav({ m }: { m: Msg }) {
  const { state, actions } = useStore();
  if (m.siblingCount < 2) return null;
  const busy = state.streaming !== null;
  const go = async (dir: -1 | 1) => {
    const target = m.siblingIndex + dir;
    if (target < 0 || target >= m.siblingCount) return;
    const sib = await fetchSiblings(m.id);
    if (sib[target]) await actions.switchSibling(sib[target]);
  };
  return (
    <span className="sibnav">
      <button disabled={busy || m.siblingIndex === 0} onClick={() => void go(-1)} aria-label="previous branch">‹</button>
      {m.siblingIndex + 1}/{m.siblingCount}
      <button disabled={busy || m.siblingIndex === m.siblingCount - 1} onClick={() => void go(1)} aria-label="next branch">›</button>
    </span>
  );
}

async function fetchSiblings(id: string): Promise<string[]> {
  const res = await fetch(`/api/messages/${id}/siblings`);
  const data = (await res.json()) as { ids: string[] };
  return data.ids;
}

/** Mood cues for the voice: derive an emotion instruction from her prose.
 *  The fine-tuned model takes free-text emotion directions (Qwen3-TTS instruct). */
function moodInstruct(text: string): string {
  const t = text.toLowerCase();
  const base = "a sharp-tongued, playfully sarcastic thirteen-year-old girl";
  if (/\b(cold|flat|icy|narrow|glare|hiss)\b/.test(t)) return `Speak coldly and flat, clipped and unimpressed — ${base}.`;
  if (/\b(yell|shout|snap|slam|furious|angry)\b/.test(t) || (text.match(/!/g)?.length ?? 0) >= 3)
    return `Speak sharply and angrily, fast and cutting — ${base}.`;
  if (/\b(whisper|quiet|soft|murmur|small voice)\b/.test(t)) return `Speak quietly and softly, guarded, almost gentle — ${base} letting the armor down an inch.`;
  if (/\b(scared|afraid|panic|trembl|flinch)\b/.test(t)) return `Speak with a hint of fear under forced composure — ${base} pretending she isn't rattled.`;
  if (/\b(sigh|tired|bored|yawns?)\b/.test(t)) return `Speak with drawling boredom, unimpressed — ${base}.`;
  if (/\b(grin|smirk|laugh|giggle|tease)\b/.test(t)) return `Speak with amused, teasing mischief — ${base} enjoying herself.`;
  return `Speak playfully and sarcastically with a confident drawl — ${base}.`;
}

export function Message({ m, isLast }: { m: Msg; isLast: boolean }) {
  const { state, actions } = useStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(m.content);
  const [speaking, setSpeaking] = useState(false);
  const busy = state.streaming !== null;

  const speak = async () => {
    if (speaking) return;
    setSpeaking(true);
    try {
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: m.content, instruct: moodInstruct(m.content) })
      });
      if (!r.ok) throw new Error("voice unavailable");
      const url = URL.createObjectURL(await r.blob());
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setSpeaking(false); };
      audio.onerror = () => { URL.revokeObjectURL(url); setSpeaking(false); };
      void audio.play();
    } catch {
      setSpeaking(false);
    }
  };

  const copy = () => void navigator.clipboard.writeText(m.content).catch(() => {});
  const checkpoint = () => {
    const name = window.prompt("Checkpoint name", "Checkpoint");
    if (name) void actions.addCheckpoint(name, m.id);
  };
  const fork = () => {
    if (window.confirm("Duplicate this chat from here? History and memories up to this message are copied.")) {
      void actions.fork(m.id);
    }
  };

  if (m.role === "user") {
    return (
      <div className="msg user">
        {editing ? (
          <div className="body" style={{ width: "85%" }}>
            <textarea
              style={{ width: "100%", background: "transparent", border: "none", resize: "vertical", minHeight: 60 }}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 6 }}>
              <button className="btn quiet" onClick={() => setEditing(false)}>Cancel</button>
              <button
                className="btn solid"
                disabled={!draft.trim() || busy}
                onClick={() => {
                  setEditing(false);
                  void actions.editUser(m.id, draft.trim());
                }}
              >
                Send as branch
              </button>
            </div>
          </div>
        ) : (
          <div className="body">{m.content}</div>
        )}
        {state.branchUi && (
          <div className="mtools">
            <Sibnav m={m} />
            <button onClick={copy}>copy</button>
            {!busy && <button onClick={() => { setDraft(m.content); setEditing(true); }}>edit</button>}
            {!busy && <button onClick={fork}>branch chat</button>}
            {!busy && <button onClick={checkpoint}>checkpoint</button>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="msg beni">
      <div className="who">
        <img src="/logo.png" alt="" />
        <span className="n">Beni</span>
        {state.settings?.ttsUrl && (
          <button
            className="iconbtn"
            title={speaking ? "speaking…" : "hear her"}
            onClick={() => void speak()}
            style={{ marginLeft: 4, opacity: speaking ? 0.5 : undefined }}
          >{speaking ? "…" : "🔊"}</button>
        )}
      </div>
      <div className="body">
        <Markdown allowedElements={["p", "em", "strong", "br", "blockquote", "ul", "ol", "li", "code"]} unwrapDisallowed>
          {m.content}
        </Markdown>
      </div>
      {state.branchUi && (
        <div className="mtools">
          <Sibnav m={m} />
          <button onClick={copy}>copy</button>
          {!busy && isLast && <button onClick={() => void actions.regenerate(m.id)}>regenerate</button>}
          {!busy && <button onClick={fork}>branch chat</button>}
          {!busy && <button onClick={checkpoint}>checkpoint</button>}
        </div>
      )}
    </div>
  );
}

/** Messaging-app behaviour: her reply stays hidden while it generates —
 *  you just see that she's writing, then the finished message lands. */
export function TypingBubble() {
  return (
    <div className="msg beni">
      <div className="who">
        <img src="/logo.png" alt="" />
        <span className="n">Beni</span>
      </div>
      <div className="body">
        <span className="typing" role="status" aria-label="Beni is typing">
          <i /><i /><i />
        </span>
      </div>
    </div>
  );
}

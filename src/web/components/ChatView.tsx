import React, { useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { Message, StreamingMessage } from "./Message.js";

function Composer() {
  const { state, actions } = useStore();
  const [text, setText] = useState("");
  const ref = useRef<HTMLTextAreaElement>(null);
  const busy = state.streaming !== null;

  const send = () => {
    const t = text.trim();
    if (!t || busy || !state.activeId) return;
    setText("");
    void actions.send(t);
  };

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
  }, [text]);

  return (
    <div className="composer">
      {state.error && (
        <div className="errbar" role="alert">
          <span>{state.error}</span>
          <button className="btn quiet" onClick={() => actions.setError(null)}>dismiss</button>
        </div>
      )}
      <div className="composer-inner">
        <textarea
          ref={ref}
          rows={1}
          placeholder={busy ? "Beni is replying…" : "Say something…"}
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        {busy ? (
          <button className="send" onClick={() => actions.stop()} aria-label="stop generating" title="Stop">
            ■
          </button>
        ) : (
          <button className="send" onClick={send} disabled={!text.trim()} aria-label="send" title="Send">
            ↑
          </button>
        )}
      </div>
    </div>
  );
}

function Peek() {
  const { state } = useStore();
  const [open, setOpen] = useState(false);
  const meta = state.streaming?.meta ?? null;
  const [last, setLast] = useState<typeof meta>(null);
  useEffect(() => {
    if (meta) setLast(meta);
  }, [meta]);
  if (!last || (last.retrieved.length === 0 && last.memories.length === 0)) return null;
  return (
    <div className="peek">
      <button className="peek-head" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} what she recalled · {last.retrieved.length} canon · {last.memories.length} memories
      </button>
      {open && (
        <div className="peek-body">
          {last.retrieved.map((r, i) => (
            <span key={i}>[canon] {r.title}{r.episode !== null ? ` · ep ${r.episode}` : ""} · {r.score}</span>
          ))}
          {last.memories.map((m, i) => (
            <span key={i}>[memory] {m}</span>
          ))}
        </div>
      )}
    </div>
  );
}

export function ChatView() {
  const { state, actions } = useStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const stage = state.stages.find((s) => s.id === state.chat?.stage_id);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [state.path, state.streaming?.text]);

  if (!state.chat) {
    return (
      <main className="main">
        <div className="chathead">
          <button className="iconbtn burger" onClick={() => actions.setSidebar(true)} aria-label="menu">☰</button>
          <span className="title">Beni</span>
        </div>
        <div className="hello">
          <div className="hello-card">
            <img src="/logo.png" alt="Beni" />
            <p>
              Pick a point in her story and start a chat. She'll know exactly as much of the world —
              and of herself — as she did right then.
            </p>
            <button className="btn solid" onClick={() => actions.setPanel("newchat")}>New chat</button>
          </div>
        </div>
      </main>
    );
  }

  const rename = () => {
    const t = window.prompt("Rename chat", state.chat!.title);
    if (t?.trim()) void actions.renameChat(state.chat!.id, t.trim());
  };

  return (
    <main className="main">
      <div className="chathead">
        <button className="iconbtn burger" onClick={() => actions.setSidebar(true)} aria-label="menu">☰</button>
        <span className="title" onDoubleClick={rename} title="double-click to rename">{state.chat.title}</span>
        <span className="chip stage">{stage?.label ?? state.chat.stage_id}</span>
        <span className="chip">
          {state.chat.mode === "story" ? `story · after ep ${state.chat.story_episode}` : `knows ≤ ep ${state.chat.episode_cap === 999 ? "end" : state.chat.episode_cap}`}
        </span>
        <span className="spacer" />
        <button className="iconbtn" title="Checkpoints" onClick={() => actions.setPanel("checkpoints")}>⚑</button>
        <button className="iconbtn" title="Memories" onClick={() => { void actions.loadMemories(); actions.setPanel("memories"); }}>✦</button>
        <button className="iconbtn" title="Delete chat" onClick={() => {
          if (window.confirm("Delete this chat and its memories?")) void actions.deleteChat(state.chat!.id);
        }}>✕</button>
      </div>

      <div className="msgs" ref={scrollRef}>
        <div className="msgs-inner">
          {state.path.map((m, i) => (
            <Message key={m.id} m={m} isLast={i === state.path.length - 1 && m.role === "assistant"} />
          ))}
          {state.streaming && state.streaming.forChat === state.chat.id && (
            <StreamingMessage text={state.streaming.text} />
          )}
        </div>
      </div>

      <Peek />
      <Composer />
    </main>
  );
}

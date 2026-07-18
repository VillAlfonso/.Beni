import React, { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "../store.js";
import { Message, TypingBubble } from "./Message.js";

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
  const atBottomRef = useRef(true);
  const [showJump, setShowJump] = useState(false);
  const stage = state.stages.find((s) => s.id === state.chat?.stage_id);

  const toBottom = useCallback((smooth = true) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior: smooth ? "smooth" : "auto" });
    atBottomRef.current = true;
    setShowJump(false);
  }, []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const fromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottomRef.current = fromBottom < 80;
    setShowJump(fromBottom > 240);
  }, []);

  // swipe right from the left edge opens the drawer (mobile)
  useEffect(() => {
    let startX = 0, startY = 0, tracking = false;
    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t.clientX < 32) { startX = t.clientX; startY = t.clientY; tracking = true; }
    };
    const move = (e: TouchEvent) => {
      if (!tracking) return;
      const t = e.touches[0];
      if (t.clientX - startX > 64 && Math.abs(t.clientY - startY) < 48) {
        tracking = false;
        actions.setSidebar(true);
      }
    };
    const up = () => { tracking = false; };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [actions]);

  // keep the composer above the on-screen keyboard (iOS/Android)
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const apply = () => {
      document.documentElement.style.setProperty("--app-h", `${vv.height}px`);
      if (atBottomRef.current) toBottom(false);
    };
    apply();
    vv.addEventListener("resize", apply);
    return () => vv.removeEventListener("resize", apply);
  }, [toBottom]);

  // follow new messages only when the reader is already at the bottom
  useEffect(() => {
    if (atBottomRef.current) toBottom();
  }, [state.path.length, state.streaming !== null, toBottom]);

  // jumping into a chat starts at the latest message
  useEffect(() => {
    atBottomRef.current = true;
    toBottom(false);
  }, [state.activeId, toBottom]);

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
        {(() => {
          try {
            const o = JSON.parse(state.chat.opinion || "");
            if (o?.label) return <span className="chip" title={o.note || "her private read on you"}>her read: {o.label}</span>;
          } catch { /* no opinion yet */ }
          return null;
        })()}
        {(() => {
          try {
            const w = JSON.parse((state.chat as { world?: string | null }).world || "");
            if (w?.clock) {
              const hot = (w.pressures ?? []).filter((p: { level: number }) => p.level >= 2).map((p: { who: string }) => p.who);
              return (
                <span className="chip" title={hot.length ? `watching closely: ${hot.join(", ")}` : "the world moves with or without you"}>
                  day {w.clock.day}{w.divergence !== "none" ? ` · ${w.divergence} divergence` : ""}{hot.length ? " · ⚠" : ""}
                </span>
              );
            }
          } catch { /* not story mode */ }
          return null;
        })()}
        <span className="spacer" />
        <button
          className={state.branchUi ? "iconbtn on" : "iconbtn"}
          title={state.branchUi ? "Hide branch tools" : "Show branch tools"}
          onClick={() => actions.setBranchUi(!state.branchUi)}
        >⑂</button>
        {state.branchUi && (
          <button className="iconbtn" title="Checkpoints" onClick={() => actions.setPanel("checkpoints")}>⚑</button>
        )}
        <button className="iconbtn" title="Memories" onClick={() => { void actions.loadMemories(); actions.setPanel("memories"); }}>✦</button>
        <button className="iconbtn" title="System channel (out of character)" onClick={() => actions.setPanel("ooc")}>⌗</button>
        <button className="iconbtn" title="Delete chat" onClick={() => {
          if (window.confirm("Delete this chat and its memories?")) void actions.deleteChat(state.chat!.id);
        }}>✕</button>
      </div>

      <div className="msgs-wrap">
        <div className="msgs" ref={scrollRef} onScroll={onScroll}>
          <div className="msgs-inner">
            {state.path.map((m, i) => (
              <Message key={m.id} m={m} isLast={i === state.path.length - 1 && m.role === "assistant"} />
            ))}
            {state.streaming && state.streaming.forChat === state.chat.id && (
              <>
                {state.streaming.pendingUser && (
                  <div className="msg user">
                    <div className="body">{state.streaming.pendingUser}</div>
                  </div>
                )}
                <TypingBubble />
              </>
            )}
          </div>
        </div>
        {showJump && (
          <button className="jump" onClick={() => toBottom()}>↓ latest</button>
        )}
      </div>

      <Peek />
      <Composer />
    </main>
  );
}

import React, { useEffect, useRef } from "react";
import { useStore } from "./store.js";
import { Sidebar } from "./components/Sidebar.js";
import { ChatView } from "./components/ChatView.js";
import { LoginGate } from "./components/LoginGate.js";
import { NewChatModal } from "./components/NewChatModal.js";
import { SettingsPanel, MemoriesPanel, CheckpointsPanel, OocPanel, JournalPanel } from "./components/Panels.js";

/**
 * Drag in from the right edge to open her log; drag it back off to close.
 * Edge-anchored so it can't fire while scrolling the conversation, and the
 * gesture has to be mostly horizontal to count.
 */
function useEdgeSwipe(open: () => void, close: () => void, isOpen: boolean) {
  const start = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const EDGE = 44;      // how close to the right edge a swipe must begin
    const DISTANCE = 55;  // how far it must travel to count
    const onStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!t) return;
      const fromEdge = window.innerWidth - t.clientX <= EDGE;
      start.current = fromEdge || isOpen ? { x: t.clientX, y: t.clientY } : null;
    };
    const onEnd = (e: TouchEvent) => {
      const s = start.current;
      const t = e.changedTouches[0];
      start.current = null;
      if (!s || !t) return;
      const dx = t.clientX - s.x;
      const dy = t.clientY - s.y;
      if (Math.abs(dx) < DISTANCE || Math.abs(dy) > Math.abs(dx)) return;
      if (dx < 0 && !isOpen) open();
      else if (dx > 0 && isOpen) close();
    };
    window.addEventListener("touchstart", onStart, { passive: true });
    window.addEventListener("touchend", onEnd, { passive: true });
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchend", onEnd);
    };
  }, [open, close, isOpen]);
}

export function App() {
  const { state, actions } = useStore();

  const journalOpen = state.panel === "journal";
  useEdgeSwipe(
    () => {
      if (state.panel === "none" && state.activeId) {
        void actions.loadJournal();
        actions.setPanel("journal");
      }
    },
    () => actions.setPanel("none"),
    journalOpen
  );

  if (state.auth === "needed") return <LoginGate />;
  if (state.auth === "unknown") return <div className="gate" aria-busy="true" />;

  return (
    <div className="shell">
      <Sidebar />
      {state.sidebarOpen && <div className="scrim" style={{ zIndex: 50 }} onClick={() => actions.setSidebar(false)} />}
      <ChatView />
      {state.panel === "newchat" && <NewChatModal />}
      {state.panel === "settings" && <SettingsPanel />}
      {state.panel === "memories" && <MemoriesPanel />}
      {state.panel === "checkpoints" && <CheckpointsPanel />}
      {state.panel === "ooc" && <OocPanel />}
      {state.panel === "journal" && <JournalPanel />}
    </div>
  );
}

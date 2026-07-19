import React from "react";
import { useStore } from "./store.js";
import { Sidebar } from "./components/Sidebar.js";
import { ChatView } from "./components/ChatView.js";
import { LoginGate } from "./components/LoginGate.js";
import { NewChatModal } from "./components/NewChatModal.js";
import { SettingsPanel, MemoriesPanel, CheckpointsPanel, OocPanel, JournalPanel } from "./components/Panels.js";

export function App() {
  const { state, actions } = useStore();

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

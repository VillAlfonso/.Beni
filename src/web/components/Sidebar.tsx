import React from "react";
import { useStore } from "../store.js";

function toggleTheme() {
  const root = document.documentElement;
  const light = root.dataset.theme === "light";
  if (light) {
    delete root.dataset.theme;
    localStorage.setItem("beni-theme", "dark");
  } else {
    root.dataset.theme = "light";
    localStorage.setItem("beni-theme", "light");
  }
}

export function Sidebar() {
  const { state, actions } = useStore();

  return (
    <aside className={`sidebar${state.sidebarOpen ? " open" : ""}`}>
      <div className="brand">
        <img src="/logo.png" alt="" />
        <div>
          <span className="name">Beni</span>
          <span className="sub">tenkai knights rp</span>
        </div>
      </div>

      <button className="newchat" onClick={() => actions.setPanel("newchat")}>
        New chat
      </button>

      <nav className="chatlist">
        {state.chats.length === 0 && <div className="empty">No chats yet. Start one.</div>}
        {state.chats.map((c) => (
          <button
            key={c.id}
            className={`chatrow${c.id === state.activeId ? " active" : ""}`}
            onClick={() => void actions.openChat(c.id)}
          >
            {c.forked_from && <span className="fork-mark" title="branched chat">⑂</span>}
            <span className="t">{c.title}</span>
            <span className="cap">{c.mode === "story" ? `ep ${c.story_episode}` : `≤${c.episode_cap === 999 ? "end" : c.episode_cap}`}</span>
          </button>
        ))}
      </nav>

      <div className="sidefoot">
        <button onClick={() => actions.setPanel("settings")}>Settings</button>
        <button onClick={toggleTheme}>Theme</button>
      </div>
    </aside>
  );
}

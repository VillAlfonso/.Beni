import React, { useMemo, useState } from "react";
import { useStore } from "../store.js";

export function NewChatModal() {
  const { state, actions } = useStore();
  const stages = state.stages;
  const [mode, setMode] = useState<"isolated" | "story">("isolated");
  const [stageId, setStageId] = useState(stages[stages.length - 1]?.id ?? "");
  const [episode, setEpisode] = useState<number>(14);
  const [title, setTitle] = useState("");
  const [userLooks, setUserLooks] = useState("");
  const [busy, setBusy] = useState(false);

  const stage = stages.find((s) => s.id === stageId) ?? stages[0];

  // story mode: the stage follows the chosen episode automatically
  const stageForEpisode = useMemo(
    () => stages.find((s) => episode >= s.episodeRange[0] && episode <= s.episodeRange[1]) ?? stages[stages.length - 1],
    [episode, stages]
  );

  const create = async () => {
    setBusy(true);
    try {
      await actions.newChat({
        title: title.trim() || undefined,
        mode,
        stageId: mode === "story" ? stageForEpisode.id : stageId,
        storyEpisode: mode === "story" ? episode : undefined,
        userLooks: userLooks.trim() || undefined
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-wrap">
      <div className="scrim" onClick={() => actions.setPanel("none")} />
      <div className="modal" role="dialog" aria-label="New chat" style={{ position: "relative", zIndex: 61 }}>
        <h2>New chat</h2>

        <div>
          <div className="mode-toggle">
            <button className={mode === "isolated" ? "on" : ""} onClick={() => setMode("isolated")}>Isolated</button>
            <button className={mode === "story" ? "on" : ""} onClick={() => setMode("story")}>Story</button>
          </div>
          <p className="mode-hint" style={{ marginTop: 8 }}>
            {mode === "isolated"
              ? "Any scenario you want — a rooftop, a rainy bus stop, another world. Beni is herself at the stage you pick below."
              : "Anchored inside the show. Pick the episode you're standing just after; Beni keeps continuity with everything up to it."}
          </p>
        </div>

        {mode === "isolated" ? (
          <div className="dial">
            <div className="dial-track">
              <div className="dial-stops">
                {stages.map((s) => (
                  <button
                    key={s.id}
                    className={`dial-stop${s.id === stageId ? " on" : ""}`}
                    onClick={() => setStageId(s.id)}
                    aria-label={s.label}
                  >
                    <span className="ep">
                      {s.episodeRange[1] >= 999 ? "after end" : `ep ${s.episodeRange[0]}–${s.episodeRange[1]}`}
                    </span>
                    <span className="dot" />
                  </button>
                ))}
              </div>
            </div>
            <div className="dial-info">
              <span className="dl">{stage?.label}</span>
              <span className="ds">{stage?.short}</span>
            </div>
          </div>
        ) : (
          <div className="field">
            <label>Just after episode</label>
            <select value={episode} onChange={(e) => setEpisode(Number(e.target.value))}>
              {state.episodes.map((ep) => (
                <option key={ep.no} value={ep.no}>
                  {String(ep.no).padStart(2, "0")} — {ep.title}
                </option>
              ))}
            </select>
            <span className="hint">
              She'll be <strong>{stageForEpisode?.label}</strong> here. {stageForEpisode?.short}
            </span>
          </div>
        )}

        <div className="field">
          <label>Title (optional)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New chat" />
        </div>

        <div className="field">
          <label>You in this chat — what she can see at a glance (optional)</label>
          <input
            value={userLooks}
            onChange={(e) => setUserLooks(e.target.value)}
            placeholder="e.g. short girl her age, freckles, denim jacket — blank uses Settings"
          />
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn quiet" onClick={() => actions.setPanel("none")}>Cancel</button>
          <button className="btn solid" disabled={busy} onClick={() => void create()}>Start</button>
        </div>
      </div>
    </div>
  );
}

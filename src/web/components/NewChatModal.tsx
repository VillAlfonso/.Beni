import React, { useState } from "react";
import { useStore } from "../store.js";

const POSTS = [
  { value: "post:s5-aftermath", label: "Three Days After — the war just ended" },
  { value: "post:s5-knight", label: "The Knight — after the finale" }
] as const;

export function NewChatModal() {
  const { state, actions } = useStore();
  const stages = state.stages;
  const [pick, setPick] = useState<string>("14");
  const [title, setTitle] = useState("");
  const [lookGender, setLookGender] = useState("");
  const [lookAge, setLookAge] = useState("");
  const [lookHeight, setLookHeight] = useState("");
  const [lookLevel, setLookLevel] = useState("");
  const [lookExtra, setLookExtra] = useState("");
  const [busy, setBusy] = useState(false);

  const composedLooks = [
    lookHeight,
    lookLevel,
    lookAge && lookGender ? `${lookAge} ${lookGender}` : lookAge || lookGender,
    lookExtra.trim()
  ]
    .filter(Boolean)
    .join(", ");

  const isPost = pick.startsWith("post:");
  const postId = isPost ? (pick.slice(5) as "s5-aftermath" | "s5-knight") : undefined;
  const episodeNo = isPost ? 52 : Number(pick);
  const ep = state.episodes.find((e) => e.no === episodeNo);

  const arcLabel = (arcId: string | null | undefined): string => {
    if (arcId === "s0-discovery") return "Before her arrival";
    const byId = stages.find((s) => s.id === arcId);
    if (byId) return byId.label;
    const ranged = stages.find((s) => episodeNo >= s.episodeRange[0] && episodeNo <= s.episodeRange[1]);
    return ranged?.label ?? "";
  };

  const hint = isPost
    ? stages.find((s) => s.id === postId)?.short ?? ""
    : ep?.covered
      ? `${arcLabel(ep.arc)} · Day ${ep.days![0]}${ep.days![1] !== ep.days![0] ? `–${ep.days![1]}` : ""} · where she is: ${ep.where ?? "not in Benham City yet"}`
      : `${arcLabel(null)} · synopsis mode — this episode's timeline data isn't authored yet, so the chat starts just after it instead of at its exact start.`;

  const create = async () => {
    setBusy(true);
    try {
      await actions.newChat({
        title: title.trim() || undefined,
        storyEpisode: isPost ? undefined : episodeNo,
        post: postId,
        userLooks: composedLooks || undefined
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

        <p className="mode-hint">
          Anchored inside the show. Pick an episode and the story opens at its exact start — where she
          canonically is, with her canon missions live. Whatever you change ripples forward from there.
        </p>

        <div className="field">
          <label>Starting point</label>
          <select value={pick} onChange={(e) => setPick(e.target.value)}>
            {state.episodes.map((e) => (
              <option key={e.no} value={String(e.no)}>
                {String(e.no).padStart(2, "0")} — {e.title}
                {e.covered
                  ? ` · Day ${e.days![0]}${e.days![1] !== e.days![0] ? `–${e.days![1]}` : ""} ✓`
                  : " · (synopsis)"}
              </option>
            ))}
            {POSTS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="hint">{hint}</span>
        </div>

        <div className="field">
          <label>Title (optional)</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="New chat" />
        </div>

        <div className="field">
          <label>You in this chat — what she can see at a glance (optional)</label>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            <select value={lookGender} onChange={(e) => setLookGender(e.target.value)}>
              <option value="">reads as…</option>
              <option value="guy">a guy</option>
              <option value="girl">a girl</option>
              <option value="hard to tell">hard to tell</option>
            </select>
            <select value={lookAge} onChange={(e) => setLookAge(e.target.value)}>
              <option value="">looks like…</option>
              <option value="a kid">a kid</option>
              <option value="her age">around her age</option>
              <option value="an older teen">an older teen</option>
              <option value="a young adult">a young adult</option>
              <option value="an adult">an adult</option>
            </select>
            <select value={lookHeight} onChange={(e) => setLookHeight(e.target.value)}>
              <option value="">height…</option>
              <option value="short">short</option>
              <option value="average height">average height</option>
              <option value="tall">tall</option>
            </select>
            <select value={lookLevel} onChange={(e) => setLookLevel(e.target.value)}>
              <option value="">looks…</option>
              <option value="ugly">ugly</option>
              <option value="plain-looking">plain</option>
              <option value="average-looking">average</option>
              <option value="good-looking">good-looking</option>
              <option value="striking">striking</option>
            </select>
          </div>
          <input
            style={{ marginTop: 6 }}
            value={lookExtra}
            onChange={(e) => setLookExtra(e.target.value)}
            placeholder="extras: hair, clothes, vibe… (blank = Settings default)"
          />
          {composedLooks && <span className="hint">She'll see: {composedLooks}</span>}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
          <button className="btn quiet" onClick={() => actions.setPanel("none")}>Cancel</button>
          <button className="btn solid" disabled={busy} onClick={() => void create()}>Start</button>
        </div>
      </div>
    </div>
  );
}

import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { api, stream, setUnauthorizedHandler } from "./api.js";
import { speak, stopVoice, unlockAudio } from "./voice.js";

export interface ChatSummary {
  id: string;
  title: string;
  mode: "isolated" | "story";
  stage_id: string;
  episode_cap: number;
  story_episode: number | null;
  forked_from: string | null;
  opinion?: string | null;
  world?: string | null;
  updated_at: number;
}

export interface Msg {
  id: string;
  parent_id: string | null;
  role: "user" | "assistant";
  content: string;
  created_at: number;
  siblingCount: number;
  siblingIndex: number;
}

export interface Checkpoint {
  id: string;
  message_id: string;
  name: string;
  created_at: number;
}

export interface Stage {
  id: string;
  label: string;
  episodeRange: [number, number];
  cap: number;
  short: string;
  greeting: string;
}

export interface Episode {
  no: number;
  title: string;
  covered: boolean;
  days: [number, number] | null;
  arc: string | null;
  where: string | null;
}

export interface Memory {
  id: string;
  text: string;
  importance: number;
  created_at: number;
}

/** One night of her log: what she made of you, and where her head is otherwise. */
export interface JournalEntry {
  id: string;
  dayLabel: string;
  read: string;
  world: string;
  created_at: number;
}

export interface RetrievalMeta {
  retrieved: { title: string; episode: number | null; score: number }[];
  memories: string[];
}

/** The per-chat simulation state served by GET /chats/:id/timeline. */
export interface TimelineView {
  covered: boolean;
  cursor?: { day: number; timeOfDay: string; episode: number };
  arc?: { id: string; label: string } | null;
  episode?: { no: number; title: string; days: [number, number] } | null;
  goals?: { id: string; who: string; text: string; status: string; due: number | null; au: boolean; note: string }[];
  divergence?: { day: number; what: string; effect: string; level: string }[];
  artifactCustody?: { item: string; name: string; holder: string; overridden: boolean }[];
  capabilities?: { capability: string; active: boolean; why: string }[];
  pressures?: { who: string; level: number; note: string }[];
  events?: string[];
  beni?: string;
}

interface State {
  auth: "unknown" | "ok" | "needed";
  chats: ChatSummary[];
  activeId: string | null;
  chat: ChatSummary | null;
  path: Msg[];
  checkpoints: Checkpoint[];
  memories: Memory[];
  stages: Stage[];
  episodes: Episode[];
  settings: Record<string, any> | null;
  streaming: { forChat: string; text: string; meta: RetrievalMeta | null; pendingUser: string | null } | null;
  panel: "none" | "settings" | "memories" | "checkpoints" | "newchat" | "ooc" | "journal" | "timeline";
  journal: JournalEntry[];
  journalBusy: boolean;
  timeline: TimelineView | null;
  branchUi: boolean;
  sidebarOpen: boolean;
  /** Which message is being spoken, if any. Lives here rather than in Message
   *  because she also starts speaking on her own, from outside any component. */
  speakingId: string | null;
  error: string | null;
}

const initial: State = {
  auth: "unknown",
  chats: [],
  activeId: null,
  chat: null,
  path: [],
  checkpoints: [],
  memories: [],
  stages: [],
  episodes: [],
  settings: null,
  streaming: null,
  panel: "none",
  journal: [],
  journalBusy: false,
  timeline: null,
  branchUi: localStorage.getItem("beni.branchUi") === "1",
  sidebarOpen: false,
  speakingId: null,
  error: null
};

type Action =
  | { type: "auth"; v: State["auth"] }
  | { type: "chats"; v: ChatSummary[] }
  | { type: "active"; v: string | null }
  | { type: "detail"; chat: ChatSummary; path: Msg[]; checkpoints: Checkpoint[] }
  | { type: "memories"; v: Memory[] }
  | { type: "character"; stages: Stage[]; episodes: Episode[] }
  | { type: "settings"; v: Record<string, any> }
  | { type: "stream-start"; forChat: string; pendingUser?: string | null }
  | { type: "stream-meta"; v: RetrievalMeta }
  | { type: "stream-token"; v: string }
  | { type: "stream-end" }
  | { type: "panel"; v: State["panel"] }
  | { type: "journal"; v: JournalEntry[] }
  | { type: "journalBusy"; v: boolean }
  | { type: "timeline"; v: TimelineView | null }
  | { type: "branchUi"; v: boolean }
  | { type: "sidebar"; v: boolean }
  | { type: "speaking"; v: string | null }
  | { type: "error"; v: string | null };

function reducer(s: State, a: Action): State {
  switch (a.type) {
    case "auth": return { ...s, auth: a.v };
    case "chats": return { ...s, chats: a.v };
    case "active": return { ...s, activeId: a.v, path: a.v === s.activeId ? s.path : [], chat: a.v === s.activeId ? s.chat : null, sidebarOpen: false };
    case "detail": return { ...s, chat: a.chat, path: a.path, checkpoints: a.checkpoints };
    case "memories": return { ...s, memories: a.v };
    case "character": return { ...s, stages: a.stages, episodes: a.episodes };
    case "settings": return { ...s, settings: a.v };
    case "stream-start": return { ...s, streaming: { forChat: a.forChat, text: "", meta: null, pendingUser: a.pendingUser ?? null }, error: null };
    case "stream-meta": return s.streaming ? { ...s, streaming: { ...s.streaming, meta: a.v } } : s;
    case "stream-token": return s.streaming ? { ...s, streaming: { ...s.streaming, text: s.streaming.text + a.v } } : s;
    case "stream-end": return { ...s, streaming: null };
    case "panel": return { ...s, panel: a.v };
    case "journal": return { ...s, journal: a.v };
    case "journalBusy": return { ...s, journalBusy: a.v };
    case "timeline": return { ...s, timeline: a.v };
    case "speaking": return { ...s, speakingId: a.v };
    case "branchUi": return { ...s, branchUi: a.v };
    case "sidebar": return { ...s, sidebarOpen: a.v };
    case "error": return { ...s, error: a.v };
  }
}

function makeActions(dispatch: React.Dispatch<Action>, getState: () => State, abortRef: React.MutableRefObject<AbortController | null>) {
  const refreshChats = async (): Promise<ChatSummary[]> => {
    const list = await api<ChatSummary[]>("GET", "/chats");
    dispatch({ type: "chats", v: list });
    return list;
  };

  const openChat = async (id: string) => {
    dispatch({ type: "active", v: id });
    const d = await api<{ chat: ChatSummary; path: Msg[]; checkpoints: Checkpoint[] }>("GET", `/chats/${id}`);
    dispatch({ type: "detail", chat: d.chat, path: d.path, checkpoints: d.checkpoints });
  };

  const reloadActive = async () => {
    const id = getState().activeId;
    if (id) await openChat(id);
  };

  /** Speak one message, routing the button state through the store so that
   *  automatic playback and the 🔊 button can't disagree about who's talking. */
  const speakMessage = (id: string, text: string) => {
    void speak(text, (on) => dispatch({ type: "speaking", v: on ? id : null }));
  };

  /** Her latest reply, spoken unprompted — unless you've turned that off. */
  const autoSpeak = () => {
    if (getState().settings?.ttsAuto === false) return;
    const path = getState().path;
    const last = path[path.length - 1];
    if (last && last.role === "assistant" && last.content.trim()) {
      speakMessage(last.id, last.content);
    }
  };

  const boot = async () => {
    try {
      await api("GET", "/me");
      dispatch({ type: "auth", v: "ok" });
      const [char, eps, settings] = await Promise.all([
        api<{ stages: Stage[] }>("GET", "/character"),
        api<Episode[]>("GET", "/episodes"),
        api<Record<string, any>>("GET", "/settings")
      ]);
      dispatch({ type: "character", stages: char.stages, episodes: eps });
      dispatch({ type: "settings", v: settings });
      const chats = await refreshChats();
      if (chats.length > 0) await openChat(chats[0].id);
    } catch {
      /* 401 handler flips auth */
    }
  };

  const login = async (key: string) => {
    await api("POST", "/login", { key });
    dispatch({ type: "auth", v: "ok" });
    await boot();
  };

  const runStream = async (url: string, body: unknown, pendingUser?: string) => {
    const chatId = getState().activeId;
    if (!chatId) return;
    abortRef.current = new AbortController();
    dispatch({ type: "stream-start", forChat: chatId, pendingUser: pendingUser ?? null });
    await stream(url, body, {
      signal: abortRef.current.signal,
      onMeta: (m) => dispatch({ type: "stream-meta", v: m }),
      onToken: (t) => dispatch({ type: "stream-token", v: t }),
      onDone: async () => {
        dispatch({ type: "stream-end" });
        await reloadActive();
        await refreshChats();
        api<Memory[]>("GET", `/chats/${chatId}/memories`).then((m) => dispatch({ type: "memories", v: m })).catch(() => {});
        // She says it herself. Only here — not on onError, and not on the abort
        // path below — so an interrupted or failed generation stays silent.
        // reloadActive() has already run, so the reply is the tail of the path
        // and carries the real message id the 🔊 button is keyed on.
        autoSpeak();
      },
      onError: async (message) => {
        dispatch({ type: "stream-end" });
        dispatch({ type: "error", v: message });
        await reloadActive();
      }
    });
    // aborted streams keep the partial server-side; refresh to show it
    if (getState().streaming) {
      dispatch({ type: "stream-end" });
      await reloadActive();
    }
  };

  return {
    boot,
    login,
    refreshChats,
    openChat,
    reloadActive,

    stop: () => abortRef.current?.abort(),

    speakMessage,
    stopSpeaking: stopVoice,

    // unlockAudio() runs inside the click or Enter that got us here. That
    // gesture is what buys permission to play her reply a few seconds later,
    // when there is no gesture left to borrow.
    send: (content: string) => {
      unlockAudio();
      return runStream(`/chats/${getState().activeId}/messages`, { content }, content);
    },
    regenerate: (messageId: string) => runStream(`/chats/${getState().activeId}/regenerate`, { messageId }),
    editUser: (messageId: string, content: string) => runStream(`/messages/${messageId}/edit`, { content }, content),

    newChat: async (opts: { title?: string; storyEpisode?: number; post?: "s5-aftermath" | "s5-knight"; userLooks?: string }) => {
      const { id } = await api<{ id: string }>("POST", "/chats", opts);
      await refreshChats();
      await openChat(id);
      dispatch({ type: "panel", v: "none" });
    },

    deleteChat: async (id: string) => {
      await api("DELETE", `/chats/${id}`);
      const chats = await refreshChats();
      if (getState().activeId === id) {
        if (chats.length > 0) await openChat(chats[0].id);
        else dispatch({ type: "active", v: null });
      }
    },

    renameChat: async (id: string, title: string) => {
      await api("PATCH", `/chats/${id}`, { title });
      await refreshChats();
      await reloadActive();
    },

    switchSibling: async (siblingId: string) => {
      await api("PATCH", `/chats/${getState().activeId}`, { headMessageId: siblingId });
      await reloadActive();
    },

    fork: async (messageId: string) => {
      const { id } = await api<{ id: string }>("POST", `/chats/${getState().activeId}/fork`, { messageId });
      await refreshChats();
      await openChat(id);
    },

    addCheckpoint: async (name: string, messageId?: string) => {
      await api("POST", `/chats/${getState().activeId}/checkpoints`, { name, messageId });
      await reloadActive();
    },

    restoreCheckpoint: async (id: string) => {
      await api("POST", `/checkpoints/${id}/restore`);
      await reloadActive();
    },

    deleteCheckpoint: async (id: string) => {
      await api("DELETE", `/checkpoints/${id}`);
      await reloadActive();
    },

    loadMemories: async () => {
      const id = getState().activeId;
      if (!id) return;
      dispatch({ type: "memories", v: await api<Memory[]>("GET", `/chats/${id}/memories`) });
    },

    deleteMemory: async (id: string) => {
      await api("DELETE", `/memories/${id}`);
      const chatId = getState().activeId;
      if (chatId) dispatch({ type: "memories", v: await api<Memory[]>("GET", `/chats/${chatId}/memories`) });
    },

    saveSettings: async (flat: Record<string, string>) => {
      dispatch({ type: "settings", v: await api<Record<string, any>>("PUT", "/settings", flat) });
    },

    loadJournal: async () => {
      const id = getState().activeId;
      if (!id) return;
      dispatch({ type: "journal", v: await api<JournalEntry[]>("GET", `/chats/${id}/journal`) });
    },

    loadTimeline: async () => {
      const id = getState().activeId;
      if (!id) return;
      dispatch({ type: "timeline", v: null });
      dispatch({ type: "timeline", v: await api<TimelineView>("GET", `/chats/${id}/timeline`) });
    },

    /** Close today's page by hand instead of waiting for the day to turn. */
    sealToday: async () => {
      const id = getState().activeId;
      if (!id) return;
      dispatch({ type: "journalBusy", v: true });
      try {
        await api("POST", `/chats/${id}/journal/seal`);
        dispatch({ type: "journal", v: await api<JournalEntry[]>("GET", `/chats/${id}/journal`) });
      } finally {
        dispatch({ type: "journalBusy", v: false });
      }
    },

    setPanel: (v: State["panel"]) => dispatch({ type: "panel", v }),
    setBranchUi: (v: boolean) => {
      localStorage.setItem("beni.branchUi", v ? "1" : "0");
      dispatch({ type: "branchUi", v });
    },
    setSidebar: (v: boolean) => dispatch({ type: "sidebar", v }),
    setError: (v: string | null) => dispatch({ type: "error", v })
  };
}

type Actions = ReturnType<typeof makeActions>;
const Ctx = createContext<{ state: State; actions: Actions } | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initial);
  const stateRef = useRef(state);
  stateRef.current = state;
  const abortRef = useRef<AbortController | null>(null);

  const actions = useMemo(() => makeActions(dispatch, () => stateRef.current, abortRef), []);

  useEffect(() => {
    setUnauthorizedHandler(() => dispatch({ type: "auth", v: "needed" }));
    void actions.boot();
  }, [actions]);

  return <Ctx.Provider value={{ state, actions }}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore outside provider");
  return ctx;
}

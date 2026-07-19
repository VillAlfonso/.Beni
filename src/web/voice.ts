/**
 * One voice at a time.
 *
 * Clicking 🔊 on a message kills whatever she was saying — that clip is thrown
 * away, unfinished. A clip that runs to the end is kept: the server files the
 * wav under what she actually said. So `addons/tts/spoken/` fills up with the
 * lines you sat through, and nothing else.
 *
 * The AudioContext is opened synchronously inside the click, because browsers
 * revoke autoplay permission a few seconds later and her first sentence can
 * take longer than that to render.
 */
const KEEP_URL = "/api/tts/keep";

interface Active {
  ctx: AudioContext;
  nodes: AudioBufferSourceNode[];
  voiceId: string | null;
  text: string;
  finished: boolean;
  setSpeaking: (v: boolean) => void;
}

let active: Active | null = null;

/** Stop the current line and discard it. Safe to call when nothing is playing. */
export function stopVoice(): void {
  const a = active;
  if (!a) return;
  active = null;
  a.finished = true; // interrupted → never kept
  for (const n of a.nodes) {
    try {
      n.onended = null;
      n.stop();
    } catch {
      /* already ended */
    }
  }
  void a.ctx.close().catch(() => {});
  a.setSpeaking(false);
}

export function isSpeaking(): boolean {
  return active !== null;
}

function keep(a: Active): void {
  if (!a.voiceId) return;
  void fetch(KEEP_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voiceId: a.voiceId, text: a.text })
  }).catch(() => {});
}

/**
 * Speak `text`. Interrupts anything already playing.
 * `setSpeaking` drives the button state for the calling message.
 */
export async function speak(text: string, setSpeaking: (v: boolean) => void): Promise<void> {
  stopVoice();

  const ctx = new AudioContext();
  void ctx.resume();
  const a: Active = { ctx, nodes: [], voiceId: null, text, finished: false, setSpeaking };
  active = a;
  setSpeaking(true);

  const abandoned = () => active !== a;

  try {
    const r = await fetch("/api/tts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text })
    });
    if (!r.ok) throw new Error("voice unavailable");
    if (abandoned()) return; // superseded while she was rendering

    a.voiceId = r.headers.get("x-voice-id");
    const restId = r.headers.get("x-voice-rest");

    // fetch the remainder while the first sentence is already playing
    const restPromise = restId
      ? fetch(`/api/tts/rest/${restId}`)
          .then(async (rr) => (rr.ok ? ctx.decodeAudioData(await rr.arrayBuffer()) : null))
          .catch(() => null)
      : Promise.resolve(null);

    const firstBuf = await ctx.decodeAudioData(await r.arrayBuffer());
    if (abandoned()) return;

    const play = (buf: AudioBuffer, onDone: () => void) => {
      const node = ctx.createBufferSource();
      node.buffer = buf;
      node.connect(ctx.destination);
      node.onended = onDone;
      a.nodes.push(node);
      node.start();
    };

    play(firstBuf, async () => {
      if (abandoned()) return;
      const restBuf = await restPromise;
      if (abandoned()) return;
      if (!restBuf) {
        a.finished = true;
        keep(a);
        active = null;
        void ctx.close().catch(() => {});
        setSpeaking(false);
        return;
      }
      play(restBuf, () => {
        if (abandoned()) return;
        a.finished = true;
        keep(a);
        active = null;
        void ctx.close().catch(() => {});
        setSpeaking(false);
      });
    });
  } catch {
    if (active === a) {
      active = null;
      void ctx.close().catch(() => {});
    }
    setSpeaking(false);
  }
}

/**
 * One voice at a time.
 *
 * Interrupting her — by clicking 🔊 again, by clicking another message's
 * button, or by her starting a new reply — throws the clip away unfinished. A
 * clip that runs to the end is kept: the server files the wav under what she
 * actually said. So `data/voice/spoken/` fills up with the lines you sat
 * through, and nothing else.
 *
 * THE AUDIO CONTEXT IS SHARED AND LONG-LIVED, and that is the whole trick
 * behind her speaking on her own. Browsers only allow audio to start from a
 * user gesture, which is why this used to open a context inside the 🔊 click —
 * autoplay permission is revoked a few seconds later, and her first sentence
 * can take longer than that to render. An automatic reply has no click to hang
 * from. But sending a message IS a gesture, and she only ever speaks in answer
 * to one, so the context is unlocked there and then kept for the session.
 */
const KEEP_URL = "/api/tts/keep";

interface Active {
  nodes: AudioBufferSourceNode[];
  voiceId: string | null;
  text: string;
  finished: boolean;
  onState: (speaking: boolean) => void;
}

let ctx: AudioContext | null = null;
let active: Active | null = null;

/**
 * Open (or wake) the shared context. MUST be called synchronously inside a real
 * user gesture — see the note above. Safe to call repeatedly; browsers suspend
 * the context when a tab is backgrounded, so this also resumes it.
 */
export function unlockAudio(): void {
  try {
    if (!ctx || ctx.state === "closed") ctx = new AudioContext();
    if (ctx.state === "suspended") void ctx.resume();
  } catch {
    /* no audio available in this browser; speak() will no-op */
  }
}

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
  a.onState(false);
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
 * `onState` drives the button for the calling message.
 *
 * Failures are silent by design: when she speaks automatically, a voice server
 * that is down must not put an error in front of a reply that is otherwise fine.
 */
export async function speak(text: string, onState: (speaking: boolean) => void): Promise<void> {
  stopVoice();
  unlockAudio();
  if (!ctx) return;
  const audio = ctx;

  const a: Active = { nodes: [], voiceId: null, text, finished: false, onState };
  active = a;
  onState(true);

  const abandoned = () => active !== a;
  const done = () => {
    if (abandoned()) return;
    a.finished = true;
    keep(a);
    active = null;
    onState(false);
  };

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
          .then(async (rr) => (rr.ok ? audio.decodeAudioData(await rr.arrayBuffer()) : null))
          .catch(() => null)
      : Promise.resolve(null);

    const firstBuf = await audio.decodeAudioData(await r.arrayBuffer());
    if (abandoned()) return;

    const play = (buf: AudioBuffer, onEnded: () => void) => {
      const node = audio.createBufferSource();
      node.buffer = buf;
      node.connect(audio.destination);
      node.onended = onEnded;
      a.nodes.push(node);
      node.start();
    };

    play(firstBuf, async () => {
      if (abandoned()) return;
      const restBuf = await restPromise;
      if (abandoned()) return;
      if (!restBuf) {
        done();
        return;
      }
      play(restBuf, done);
    });
  } catch {
    if (active === a) {
      active = null;
      onState(false);
    }
  }
}

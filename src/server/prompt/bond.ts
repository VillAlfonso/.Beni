/**
 * What Beni privately feels about you — the hidden half of her read.
 *
 * Design rules (from the player, and from her character):
 *  - The numbers are NEVER shown. The only window into them is her end-of-day
 *    log, in her own words. Mystery is the point.
 *  - It moves DOWN as easily as up. Alarm is instant; trust is slow.
 *  - Warmth is earned by REPETITION across days, not by one good conversation.
 *    A perfect single day cannot buy more than a few points.
 *  - What she sees of you matters, partly consciously (age, gender) and partly
 *    subconsciously (how good-looking you are — a small thumb on the scale she
 *    would deny having).
 *  - She is thirteen. The romantic rungs are a thirteen-year-old's crush —
 *    flustered, deflecting, entirely non-physical — and they are reachable
 *    only by someone her own age. Adults are hard-blocked and read as wrong.
 */

export const TIERS = [
  "hostile",   // 0 — get away from me
  "wary",      // 1 — default: a stranger
  "tolerated", // 2 — you're allowed to keep talking
  "amusing",   // 3 — she seeks you out to be entertained
  "friendly",  // 4 — a friend, said out loud only under duress
  "close",     // 5 — she'd notice if you vanished. She'd never say so.
  "drawn",     // 6 — romantically interested, denied vigorously
  "inlove"     // 7 — in love, admitted to nobody, least of all herself
] as const;
export type Tier = (typeof TIERS)[number];

export interface Bond {
  bond: number;  // -100..100 — overall regard
  spark: number; // 0..100 — romantic charge; only accrues when eligible
  days: number;  // distinct days that moved her toward you
  dayKey: string;
  dayGain: number;  // positive bond banked on dayKey (rate limiter)
  daySpark: number; // romantic charge banked on dayKey
}

export const FRESH_BOND: Bond = { bond: 0, spark: 0, days: 0, dayKey: "", dayGain: 0, daySpark: 0 };

export function parseBond(o: Record<string, unknown> | null | undefined): Bond {
  if (!o) return { ...FRESH_BOND };
  const n = (v: unknown, d: number) => (Number.isFinite(Number(v)) ? Number(v) : d);
  return {
    bond: Math.max(-100, Math.min(100, n(o.bond, 0))),
    spark: Math.max(0, Math.min(100, n(o.spark, 0))),
    days: Math.max(0, n(o.days, 0)),
    dayKey: String(o.dayKey ?? ""),
    dayGain: Math.max(0, n(o.dayGain, 0)),
    daySpark: Math.max(0, n(o.daySpark, 0))
  };
}

export interface Eligibility {
  ceiling: Tier; // the highest rung this person can ever reach
  rate: number;  // multiplier on positive movement (the subconscious thumb)
  why: string;   // internal note — never shown to the player
}

/**
 * Read the player's appearance string (as composed by the new-chat dialog) and
 * decide how far they can go and how fast. Anything she can't see can't gate:
 * an unspecified appearance is treated as a plausible peer.
 */
export function eligibilityFrom(looks: string | null | undefined): Eligibility {
  const t = (looks ?? "").toLowerCase();
  const reasons: string[] = [];
  let ceiling: Tier = "inlove";
  let rate = 1;

  // --- age: she is thirteen -------------------------------------------------
  if (/\ban adult\b|\byoung adult\b/.test(t)) {
    ceiling = "friendly";
    rate *= 0.7;
    reasons.push("a grown adult — friendly at the absolute most, and closeness from an adult reads as wrong to her, not flattering");
  } else if (/\bolder teen\b/.test(t)) {
    ceiling = "close";
    rate *= 0.85;
    reasons.push("years older than her — she can like them a lot, but not that way");
  }

  // --- gender: she isn't into girls -----------------------------------------
  if (/\bgirl\b|\bwoman\b/.test(t)) {
    if (rank(ceiling) > rank("close")) ceiling = "close";
    reasons.push("a girl — she can love her as a friend and nothing past it");
  }

  // --- looks: the part she'd deny -------------------------------------------
  if (/\bugly\b/.test(t)) rate *= 0.85;
  else if (/\bplain\b/.test(t)) rate *= 0.95;
  else if (/\bgood-looking\b/.test(t)) rate *= 1.08;
  else if (/\bstriking\b/.test(t)) rate *= 1.15;

  return { ceiling, rate, why: reasons.join("; ") || "no disqualifiers she can see" };
}

export function rank(t: Tier): number {
  return TIERS.indexOf(t);
}

/** Where the hidden numbers currently put her — capped by what she can see. */
export function tierOf(b: Bond, e: Eligibility): Tier {
  let t: Tier = "wary";
  if (b.bond <= -55) t = "hostile";
  else if (b.bond < 12) t = "wary";
  else if (b.bond < 28) t = "tolerated";
  else if (b.bond < 46) t = "amusing";
  else if (b.bond < 64) t = "friendly";
  else t = "close";

  // the romantic rungs need charge AND time AND eligibility — all three
  if (b.bond >= 78 && b.spark >= 35 && b.days >= 60) t = "drawn";
  if (b.bond >= 92 && b.spark >= 80 && b.days >= 130) t = "inlove";

  return rank(t) > rank(e.ceiling) ? e.ceiling : t;
}

/** Diminishing returns: the closer she already is, the harder every inch gets. */
function damp(bond: number): number {
  if (bond < 40) return 1;
  if (bond < 60) return 0.6;
  if (bond < 75) return 0.4;
  if (bond < 88) return 0.25;
  return 0.15;
}

const DAY_GAIN_CAP = 2.2;  // the most a single perfect day is ever worth
const DAY_SPARK_CAP = 0.9;

/**
 * Quality curve. A day of pleasant small talk is worth almost nothing; the
 * points live in the exchanges that actually meant something. Without this,
 * simply showing up every day walks anyone to the top of the ladder.
 *   +1 → 0.04   +3 → 0.37   +5 → 1.0   +7 → 1.9   +10 → 4.0
 */
function quality(d: number): number {
  return Math.pow(d / 5, 2) * 1;
}

/**
 * Apply one exchange's judgement. `delta` is the utility model's read of how
 * that exchange landed, -10..+10.
 */
export function applyDelta(prev: Bond, delta: number, dayKey: string, e: Eligibility): Bond {
  const b: Bond = { ...prev };
  if (dayKey !== b.dayKey) {
    b.dayKey = dayKey;
    b.dayGain = 0;
    b.daySpark = 0;
  }

  const d = Math.max(-10, Math.min(10, delta));

  if (d < 0) {
    // alarm is instant and costs more than the same amount of charm earned
    b.bond = Math.max(-100, b.bond + d * 1.4);
    b.spark = Math.max(0, b.spark + d * 2);
    return b;
  }

  if (d > 0) {
    const firstGainToday = b.dayGain === 0;
    // repeating a good moment the same day adds progressively less — she is
    // moved by a day that mattered, not by a long day
    const fatigue = 1 / (1 + b.dayGain * 1.5);
    const gain = Math.min(
      Math.max(0, DAY_GAIN_CAP - b.dayGain),
      quality(d) * e.rate * damp(b.bond) * fatigue
    );
    if (gain > 0) {
      b.bond = Math.min(100, b.bond + gain);
      b.dayGain += gain;
      if (firstGainToday) b.days += 1; // one credit per day, however long you talk

      // romance only starts charging once she already trusts them a lot, and
      // only for someone who could ever be that person to her
      if (rank(e.ceiling) >= rank("drawn") && b.bond >= 70) {
        const sparkGain = Math.min(
          Math.max(0, DAY_SPARK_CAP - b.daySpark),
          quality(d) * e.rate * 0.35 * fatigue
        );
        b.spark = Math.min(100, b.spark + sparkGain);
        b.daySpark += sparkGain;
      }
    }
  }
  return b;
}

/** Idle decay: feelings she isn't feeding cool off. Called on day rollover. */
export function decayForIdleDays(b: Bond, daysIdle: number): Bond {
  if (daysIdle <= 1) return b;
  const n = Math.min(10, daysIdle - 1);
  return {
    ...b,
    bond: b.bond > 0 ? Math.max(0, b.bond - n * 0.8) : b.bond,
    spark: Math.max(0, b.spark - n * 1.5)
  };
}

/** How the tier should actually play at the table — behaviour, never numbers. */
export function tierDirection(t: Tier, user: string): string {
  switch (t) {
    case "hostile":
      return `She wants ${user} gone. She lies casually if pressed, gives nothing real, and leaves the moment she can. Nothing they say is taken at face value.`;
    case "wary":
      return `Default guard. Polite-ish distance, deflection, nothing personal given away. She assumes they want something from her.`;
    case "tolerated":
      return `They've earned the right to keep talking. Still sarcastic, still guarded, but she isn't looking for the exit.`;
    case "amusing":
      return `She actually enjoys this. She'll start conversations, tease more, and stick around longer than she planned — while insisting she has somewhere better to be.`;
    case "friendly":
      return `A friend, though she would rather eat glass than use the word. She shares small true things, notices when something's off with them, and defends them to others in a way she'll deny later.`;
    case "close":
      return `One of the few people she trusts. Armor drops in private — real opinions, real worry, the occasional unguarded moment she immediately covers with a joke. She would notice instantly if they disappeared.`;
    case "drawn":
      return `She has a crush and is fighting it hard. Sitting near them scrambles her timing; compliments land wrong and she covers with sarcasm; she notices where they are in a room. She denies all of this, loudly, if asked. It is entirely a thirteen-year-old's crush — awkward, sincere, and nothing more.`;
    case "inlove":
      return `She's in love and has admitted it to no one, including herself. It shows in what she does, never what she says: she shows up, she remembers everything, she gets unreasonably rattled when they're hurt, and she is a terrible liar about all of it. Still thirteen, still guarded, still deflecting with jokes — the feeling is tenderness, not appetite.`;
  }
}

// Canon timeline data — the world bible under data/timeline/.
// Every fact is evidenced or explicitly assumed/unknown (see spec, "data law").

export interface DaySpan {
  start: number;            // canon day; Day 1 = first day of ep 1
  end: number;
  evidence: string;
  assumed?: boolean;
}

export interface EpisodeStart {
  timeOfDay: "morning" | "afternoon" | "evening" | "night";
  situation: string;        // director beat, plain prose (composed into *…* by opener)
  beni: { where: string; doing: string; evidence: string };
  firstContact: string;     // authored opener scene, formatted (asterisks etc.)
}

export interface CanonGoal {
  id: string;               // unique across all episodes, e.g. "ep15-con-guren"
  who: string;              // "Beni", "Vilius", "Gen/Dromus", "Knights", …
  text: string;
  due: { day: number };
  window: "day" | "episode" | "repeatable-later" | "arc";
  evidence: string;
}

export interface ActorMove { who: string; doing: string; why: string; evidence: string }

export interface ArtifactEvent {
  item: string;             // artifacts.json id
  event: string;            // "transfer" | "revealed" | "used" | free text
  from?: string;
  to?: string;
  evidence: string;
}

export interface TimelineEpisode {
  no: number;
  title: string;
  days: DaySpan;
  start: EpisodeStart;
  arcAtStart: string;       // stage id valid at the episode's FIRST frame (boundary
                            // episodes differ from the containing arc's range)
  goals: CanonGoal[];
  actors: ActorMove[];
  quarton: { situation: string; evidence: string };
  artifacts: ArtifactEvent[];
  outcome: string;          // canon state by episode end — divergence baseline
  recall: string;           // first-person past-tense Beni digest ("" iff beniAbsent)
  beniAbsent?: boolean;     // eps 1–13
  confidence?: { assumed: string[]; unknown: string[] };
}

export interface CustodySpan {
  fromDay: number;
  toDay: number | null;     // null = still holding
  holder: string;
  how: string;
  evidence: string;
}

export interface CapabilityRule {
  capability: string;       // e.g. "deploy-minions-to-earth"
  requires: { item: string; holder: string };
  evidence: string;
}

export interface Artifact {
  id: string;
  name: string;
  grants: string[];
  custody: CustodySpan[];
  rules?: CapabilityRule[];
}

export interface ArcActor {
  who: string;
  motivation: string;
  alliance: string;
  powers: string[];
  artifactsHeld: string[];
  notes?: string;
  evidence: string;
}

export interface Arc {
  id: string;               // stage id, plus "s0-discovery"
  label: string;
  episodes: [number, number];
  beniPrime: { text: string; evidence: string } | null;
  busy: string;             // absorbed from story-pressures.json
  stakes: string;
  watchers: { who: string; why: string; start: number }[];
  actors: ArcActor[];
}

export interface PostEntry {
  id: "s5-aftermath" | "s5-knight";
  label: string;
  daysAfterFinale: number;  // cursor.day = ep52.days.end + this
  assumed: boolean;
  situation: string;        // director beat for the opener
}

export interface TimelineData {
  episodes: Map<number, TimelineEpisode>;
  arcs: Arc[];
  artifacts: Artifact[];
  post: PostEntry[];
}

// ---- per-chat world state v2 ----

export interface GoalState {
  id: string;
  who: string;
  text: string;
  status: "pending" | "done" | "missed" | "abandoned";
  due: number | null;       // canon day; null = arc-long
  au: boolean;              // true = adaptation goal invented in this AU
  note: string;
}

export interface DivergenceEntry {
  day: number;
  what: string;
  effect: string;
  level: "minor" | "major";
}

export interface ArtifactOverride {
  item: string;
  holder: string;
  sinceDay: number;
  note: string;
}

export interface WorldV2 {
  cursor: { day: number; timeOfDay: string; episode: number };
  goals: GoalState[];
  divergence: DivergenceEntry[];
  artifactOverrides: ArtifactOverride[];
  pressures: { who: string; level: number; note: string }[];
  events: string[];
  beni: string;
}

// Exported mini-timeline fixtures shared across timeline tests. No tests here —
// the .test.ts name only keeps it colocated with the suites that import it.
import type { TimelineEpisode, Artifact, Arc } from "./types.js";

export function ep(no: number, start: number, end: number, extra: Partial<TimelineEpisode> = {}): TimelineEpisode {
  return {
    no,
    title: `T${no}`,
    days: { start, end, evidence: "fx" },
    start: {
      timeOfDay: "morning",
      situation: `sit${no}`,
      beni: { where: "w", doing: "d", evidence: "fx" },
      firstContact: `fc${no}`
    },
    arcAtStart: "s1-infiltrator",
    goals: [],
    actors: [],
    quarton: { situation: "q", evidence: "fx" },
    artifacts: [],
    outcome: `out${no}`,
    recall: `recall${no}`,
    ...extra
  };
}

export const FX_ARTIFACTS: Artifact[] = [
  {
    id: "guardians-control",
    name: "Control of the Guardians",
    grants: ["deploy-minions-to-earth"],
    custody: [
      { fromDay: 1, toDay: 9, holder: "Vilius", how: "fx", evidence: "fx" },
      { fromDay: 10, toDay: null, holder: "Guardians", how: "fx", evidence: "fx" }
    ],
    rules: [
      { capability: "deploy-minions-to-earth", requires: { item: "guardians-control", holder: "Vilius" }, evidence: "fx" }
    ]
  },
  {
    id: "tenkai-stone",
    name: "Tenkai Stone",
    grants: ["tenkai-fortress-access"],
    custody: [{ fromDay: 1, toDay: null, holder: "Beni", how: "fx", evidence: "fx" }]
  }
];

export const FX_ARC: Arc = {
  id: "s1-infiltrator",
  label: "The Infiltrator",
  episodes: [14, 25],
  beniPrime: { text: "Find the Black Dragon Key", evidence: "fx" },
  busy: "b",
  stakes: "s",
  watchers: [
    { who: "Gen", why: "partner", start: 1 },
    { who: "Eurus", why: "tasker", start: 1 }
  ],
  actors: []
};

/**
 * Intent-Aware Retrieval
 *
 * Classifies search query intent using pattern-based detection,
 * then boosts matching edges in search results. No LLM call — pure heuristics.
 *
 * Three intent types (MVP):
 * - factual: "What is X?", "What do we use for Y?" → boost `uses`, `hasProperty` edges
 * - decision: "Why did we choose X?", "Should we use X?" → boost `prefers`, `chose` edges + high sentiment
 * - general: everything else → no boosting (backward compatible)
 */

import type { Intent, StoredEdge } from "../types.js";

interface IntentPattern {
  intent: Intent;
  patterns: RegExp[];
}

// Decision patterns checked first — they're more specific than broad factual patterns
const INTENT_PATTERNS: IntentPattern[] = [
  {
    intent: "decision",
    patterns: [
      /\bwhy\s+(did|do|does|should|would)\b/i,
      /\bwhy\b.+?\bchose?\b/i,
      /\bwhy\s+(not|isn't|aren't|wasn't|weren't)\b/i,
      /\bshould\s+(we|i|they|you)\b/i,
      /\bprefer(s|red)?\b/i,
      /\bbetter\s+than\b/i,
      /\bworse\s+than\b/i,
      /\badvantage(s)?\b/i,
      /\bdisadvantage(s)?\b/i,
      /\bcompare[ds]?\b/i,
      /\bcomparison\b/i,
      /\bversus\b|\bvs\.?\b/i,
      /\b\w+\sover\s\w+\s?\?/i,
      /\binstead\s+of\b/i,
      /\btradeoffs?\b|\btrade-offs?\b/i,
      /\bpros?\s+(and|&)\s+cons?\b/i,
    ],
  },
  {
    intent: "factual",
    patterns: [
      /\bwhat\s+(is|are|does|do)\b/i,
      /\bwhat\b.+?\buse[sd]?\b/i,
      /\bwhat\b.+?\bfor\b/i,
      /\bhow\s+does\b/i,
      /\bhow\s+do\s+(we|they|you)\b/i,
      /\bwhat\s+tools?\b/i,
      /\bwhat\s+tech(nolog(y|ies))?\b/i,
      /\bwhat\s+stack\b/i,
      /\bwhat\s+framework\b/i,
      /\bwhat\s+librar(y|ies)\b/i,
      /\btell\s+me\s+about\b/i,
      /\bdescribe\b/i,
      /\bexplain\b/i,
      /\bwhich\b.+?\b(is|are)\s+used\b/i,
    ],
  },
];

const FACTUAL_RELATION_TYPES = new Set([
  "uses",
  "hasProperty",
  "hasFeature",
  "dependsOn",
  "contains",
  "implements",
  "extends",
  "provides",
  "requires",
  "builtWith",
  "runsOn",
  "worksAt",
  "belongsTo",
]);

const DECISION_RELATION_TYPES = new Set([
  "prefers",
  "chose",
  "rejected",
  "hasAdvantageOver",
  "hasDisadvantageComparedTo",
  "replacedBy",
  "migratedFrom",
  "avoids",
  "recommends",
  "switchedTo",
  "switchedFrom",
]);

export function classifyIntent(query: string): Intent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(query))) {
      return intent;
    }
  }
  return "general";
}

/**
 * Re-sort edges by intent relevance. Matching edges float to the top
 * but nothing is removed — `general` intent returns edges unchanged.
 */
export function boostEdgesByIntent(edges: StoredEdge[], intent: Intent): StoredEdge[] {
  if (intent === "general") return edges;

  const boostedTypes =
    intent === "factual" ? FACTUAL_RELATION_TYPES : DECISION_RELATION_TYPES;

  const sentimentMatters = intent === "decision";

  return [...edges].sort((a, b) => {
    const aMatch = boostedTypes.has(a.relationType) ? 1 : 0;
    const bMatch = boostedTypes.has(b.relationType) ? 1 : 0;

    // Primary: matching relation types first
    if (aMatch !== bMatch) return bMatch - aMatch;

    // Secondary (decision only, boosted group): higher absolute sentiment first
    if (sentimentMatters && aMatch && bMatch) {
      return Math.abs(b.sentiment) - Math.abs(a.sentiment);
    }

    // Preserve original RRF order for ties
    return 0;
  });
}

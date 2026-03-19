import type { StoredEntity } from "@/types";

/**
 * Normalize an entity name for canonical comparison.
 * Lowercase, trim, strip leading slashes, collapse whitespace/hyphens.
 * No singularization — the LLM handles semantic matching at extraction time.
 */
export function normalizeEntityName(name: string): string {
  let n = name.trim().toLowerCase();
  n = n.replace(/^\/+/, "");
  n = n.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  return n;
}

/**
 * Find the best matching entity from a list of candidates by canonical name.
 */
export function findMatchingEntity(
  name: string,
  candidates: Array<{ uuid: string; name: string; deletedAt?: string }>,
): { uuid: string; name: string; deletedAt?: string } | null {
  const normalized = normalizeEntityName(name);
  for (const candidate of candidates) {
    if (normalizeEntityName(candidate.name) === normalized) {
      return candidate;
    }
  }
  return null;
}

export interface DuplicateGroup {
  keep: StoredEntity & { uuid: string };
  duplicates: Array<StoredEntity & { uuid: string }>;
  normalizedName: string;
}

/**
 * Group entities by canonical name within the same namespace.
 * Returns only groups with 2+ entities (actual duplicates).
 */
export function groupDuplicateEntities(
  entities: Array<StoredEntity & { uuid: string }>,
): DuplicateGroup[] {
  const groups = new Map<string, Array<StoredEntity & { uuid: string }>>();

  for (const entity of entities) {
    const key = `${normalizeEntityName(entity.name)}::${entity.namespace ?? "default"}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entity);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [key, group] of groups) {
    if (group.length <= 1) continue;
    const normalizedName = key.split("::")[0]!;
    duplicates.push({
      keep: group[0]!,
      duplicates: group.slice(1),
      normalizedName,
    });
  }

  return duplicates;
}

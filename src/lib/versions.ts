/**
 * KB-specific schema version declarations.
 *
 * Each schema version tracks when a prompt/model/extraction format changed.
 * The self-evolving worker uses these to detect stale memories and regenerate.
 */
import {
  SchemaVersion,
  semver,
  isoFrom,
} from "../../libs/wystack/packages/version/src/index";

export const summarySchema = new SchemaVersion({
  current: semver("2.0.0"),
  changelog: [
    {
      version: semver("1.0.0"),
      date: isoFrom("2026-01-15"),
      description: "Initial: 1-2 sentence summary",
      breaking: false,
    },
    {
      version: semver("2.0.0"),
      date: isoFrom("2026-03-16"),
      description: "Paragraph L1 summary + L0 abstract",
      breaking: true,
    },
  ],
  staleness: { maxAgeDays: 30 },
});

export const embeddingSchema = new SchemaVersion({
  current: semver("1.1.0"),
  changelog: [
    {
      version: semver("1.0.0"),
      date: isoFrom("2026-01-15"),
      description: "Ollama 2560-dim only",
      breaking: false,
    },
    {
      version: semver("1.1.0"),
      date: isoFrom("2026-02-20"),
      description: "Added 384-dim fallback index",
      breaking: false,
    },
  ],
});

export const extractionSchema = new SchemaVersion({
  current: semver("1.1.0"),
  changelog: [
    {
      version: semver("1.0.0"),
      date: isoFrom("2026-01-15"),
      description: "Entities + edges + summary",
      breaking: false,
    },
    {
      version: semver("1.1.0"),
      date: isoFrom("2026-02-27"),
      description: "Added memory categories",
      breaking: false,
    },
  ],
});

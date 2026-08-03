import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AUTOMATION_JOBS } from "@/lib/automations";

// AUTOMATION_JOBS carries the human-readable description of each scheduled
// job, but Vercel only reads vercel.json — the comment in automations.ts says
// "keep them in sync" and this test makes that an enforced invariant. A job in
// one list but not the other either runs invisibly (no Settings entry, no
// health monitoring) or shows a schedule that never fires.

const crons: { path: string; schedule: string }[] = JSON.parse(
  readFileSync(join(__dirname, "../../../vercel.json"), "utf8")
).crons;

describe("AUTOMATION_JOBS ↔ vercel.json crons", () => {
  it("every registered job has a cron entry with the same expression", () => {
    for (const job of AUTOMATION_JOBS) {
      const cron = crons.find((c) => c.path === `/api/cron/${job.slug}`);
      expect(cron, `vercel.json is missing /api/cron/${job.slug}`).toBeDefined();
      expect(cron?.schedule, `schedule mismatch for ${job.slug}`).toBe(job.cron);
    }
  });

  it("every cron entry has a registered job", () => {
    for (const cron of crons) {
      const slug = cron.path.replace("/api/cron/", "");
      const job = AUTOMATION_JOBS.find((j) => j.slug === slug);
      expect(job, `AUTOMATION_JOBS is missing "${slug}"`).toBeDefined();
    }
  });
});

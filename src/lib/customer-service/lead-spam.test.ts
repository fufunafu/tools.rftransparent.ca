import { describe, expect, it } from "vitest";
import {
  LEAD_SPAM_REASON,
  assessLeadSpam,
  isLeadSpamReason,
} from "@/lib/customer-service/lead-spam";

describe("lead spam classification", () => {
  it.each([
    ["We provide search engine optimization for your website", "search-engine-optimization"],
    ["We can put your website on the first page of Google", "google-ranking"],
    ["I can supply high authority backlinks", "link-building"],
    ["Would you accept a sponsored guest post?", "guest-post"],
  ])("classifies an obvious marketing pitch", (message, category) => {
    expect(assessLeadSpam({ source: "website", message })).toEqual({
      isSpam: true,
      category,
    });
  });

  it("requires a solicitation cue for a generic SEO reference", () => {
    expect(assessLeadSpam({
      source: "website",
      email: "sales@seo-agency.example",
      message: "I can help improve your SEO with our services",
    })).toMatchObject({ isSpam: true, category: "marketing-solicitation" });

    expect(assessLeadSpam({
      source: "website",
      message: "I found your railing company while researching SEO trends and need a quote",
    })).toEqual({ isSpam: false, category: null });
  });

  it("does not classify genuine project inquiries", () => {
    expect(assessLeadSpam({
      source: "website",
      message: "Please quote 34 feet of glass railing for my deck",
    })).toEqual({ isSpam: false, category: null });
  });

  it("does not auto-classify Meta leads", () => {
    expect(assessLeadSpam({
      source: "meta",
      message: "We offer backlinks and guest posts",
    })).toEqual({ isSpam: false, category: null });
  });

  it("recognizes generated and staff-entered spam reasons", () => {
    expect(isLeadSpamReason(LEAD_SPAM_REASON)).toBe(true);
    expect(isLeadSpamReason("Spam submission")).toBe(true);
    expect(isLeadSpamReason("Historical import")).toBe(false);
  });
});

import { describe, it, expect } from "vitest";
import { classifyCampaignCountry } from "@/lib/google-ads";

describe("classifyCampaignCountry", () => {
  it('returns "us" for campaigns with USA in name', () => {
    expect(classifyCampaignCountry("Brand - USA - Search")).toBe("us");
  });

  it('returns "us" for campaigns with US state names', () => {
    expect(classifyCampaignCountry("PMax - California")).toBe("us");
    expect(classifyCampaignCountry("Search - Texas - Brand")).toBe("us");
    expect(classifyCampaignCountry("Florida Remarketing")).toBe("us");
  });

  it('returns "ca" for campaigns with CA keyword', () => {
    expect(classifyCampaignCountry("Brand - CA - Search")).toBe("ca");
  });

  it('returns "ca" for campaigns with Ontario', () => {
    expect(classifyCampaignCountry("PMax - Ontario")).toBe("ca");
  });

  it('returns "both" for US/CA campaigns', () => {
    expect(classifyCampaignCountry("Brand - US/CA - All")).toBe("both");
  });

  it("returns null for unclassified campaigns", () => {
    expect(classifyCampaignCountry("Brand - Generic")).toBeNull();
    expect(classifyCampaignCountry("Remarketing")).toBeNull();
  });

  it("does not classify California as CA", () => {
    // "California" contains "CA" but should be classified as US (state), not CA (country)
    expect(classifyCampaignCountry("PMax - California")).toBe("us");
  });
});

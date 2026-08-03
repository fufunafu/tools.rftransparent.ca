import { describe, expect, it } from "vitest";
import {
  configuredSalesReps,
  resolveSalesAttribution,
} from "@/lib/sales-attribution";

const reps = configuredSalesReps([
  { id: "anne", department: "sales", shopify_tags: ["Anne", "Anne R"] },
  { id: "ben", department: "sales", shopify_tags: ["Ben"] },
  { id: "warehouse", department: "warehouse", shopify_tags: ["Packing"] },
  { id: "untagged", department: "sales", shopify_tags: [] },
]);

describe("sales attribution", () => {
  it("ignores location and workflow tags", () => {
    expect(resolveSalesAttribution(["Laval", "Website", "Anne"], reps)).toEqual({
      status: "unique",
      employeeId: "anne",
    });
    expect(resolveSalesAttribution(["Laval", "Website"], reps)).toEqual({
      status: "unassigned",
    });
  });

  it("counts multiple aliases for the same rep once", () => {
    expect(resolveSalesAttribution(["Anne", "Anne R"], reps)).toEqual({
      status: "unique",
      employeeId: "anne",
    });
  });

  it("excludes a record with tags for two sales reps", () => {
    expect(resolveSalesAttribution(["Anne", "Ben"], reps)).toEqual({
      status: "ambiguous",
    });
  });

  it("excludes duplicated tag ownership across employees", () => {
    const duplicateOwners = configuredSalesReps([
      { id: "one", department: "sales", shopify_tags: ["shared"] },
      { id: "two", department: "sales", shopify_tags: ["shared"] },
    ]);

    expect(resolveSalesAttribution(["shared"], duplicateOwners)).toEqual({
      status: "ambiguous",
    });
  });
});

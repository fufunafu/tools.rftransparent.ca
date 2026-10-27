import { describe, expect, it } from "vitest";
import { mobileRoleActions } from "@/lib/mobile-home";

describe("mobile role actions", () => {
  it.each([
    ["sales", "/sales"],
    ["warehouse", "/warehouse/report"],
    ["customer_service", "/customer-service#callbacks"],
    ["marketing", "/dashboards/marketing"],
  ])("puts the %s frontline destination first", (department, href) => {
    expect(mobileRoleActions(department)[0].href).toBe(href);
  });

  it("marks warehouse external tools clearly", () => {
    const external = mobileRoleActions("warehouse").filter((action) => action.external);
    expect(external.map((action) => action.id)).toEqual(["order-stream", "customs"]);
  });
});

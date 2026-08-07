import { describe, expect, it } from "vitest";
import { safeNextPath, sessionExpiredLoginUrl } from "@/lib/client-auth";

describe("client authentication redirects", () => {
  it("preserves a safe local return path", () => {
    expect(sessionExpiredLoginUrl("/customer-service/leads?source=meta")).toBe(
      "/login?error=session_expired&next=%2Fcustomer-service%2Fleads%3Fsource%3Dmeta",
    );
  });

  it("rejects protocol-relative return paths", () => {
    expect(safeNextPath("//malicious.example/path")).toBe("/");
  });
});

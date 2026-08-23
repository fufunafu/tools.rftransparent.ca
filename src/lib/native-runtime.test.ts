import { describe, expect, it } from "vitest";
import {
  isLocalDevelopmentOrigin,
  isProtectedNativePath,
  isTrustedAppUrl,
} from "@/lib/native-runtime";

describe("native runtime boundaries", () => {
  it.each(["/", "/clock", "/warehouse/report"])("protects authenticated path %s", (path) => {
    expect(isProtectedNativePath(path)).toBe(true);
  });

  it.each(["/login", "/privacy", "/support", "/print/po/1", "/survey/token", "/wall/token"])("does not lock public path %s", (path) => {
    expect(isProtectedNativePath(path)).toBe(false);
  });

  it("trusts only HTTPS navigation on the current RF Tools origin", () => {
    const origin = "https://tools.rftransparent.ca";
    expect(isTrustedAppUrl("/clock", origin)).toBe(true);
    expect(isTrustedAppUrl("https://tools.rftransparent.ca/todos", origin)).toBe(true);
    expect(isTrustedAppUrl("http://tools.rftransparent.ca/todos", origin)).toBe(false);
    expect(isTrustedAppUrl("https://tools.rftransparent.ca.evil.example/", origin)).toBe(false);
    expect(isTrustedAppUrl("https://orderstream-checker.vercel.app/", origin)).toBe(false);
  });

  it("keeps exact-origin local development links inside the native shell", () => {
    const origin = "http://127.0.0.1:3000";
    expect(isTrustedAppUrl("/clock", origin)).toBe(true);
    expect(isTrustedAppUrl("http://127.0.0.1:3000/todos", origin)).toBe(true);
    expect(isTrustedAppUrl("http://localhost:3000/todos", origin)).toBe(false);
    expect(isTrustedAppUrl("http://127.0.0.1:4000/todos", origin)).toBe(false);
    expect(isTrustedAppUrl("https://example.com/", origin)).toBe(false);
  });

  it("recognizes only loopback HTTP origins as local previews", () => {
    expect(isLocalDevelopmentOrigin("http://127.0.0.1:3000")).toBe(true);
    expect(isLocalDevelopmentOrigin("http://localhost:3000")).toBe(true);
    expect(isLocalDevelopmentOrigin("https://127.0.0.1:3000")).toBe(false);
    expect(isLocalDevelopmentOrigin("https://tools.rftransparent.ca")).toBe(false);
  });

  it("does not trust an arbitrary current HTTPS origin", () => {
    expect(isTrustedAppUrl("https://evil.example/clock", "https://evil.example")).toBe(false);
    expect(isTrustedAppUrl("https://tools.rftransparent.ca/clock", "https://evil.example")).toBe(true);
  });
});

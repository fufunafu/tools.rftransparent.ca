import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isLoopbackHostname,
  testLoginEnabled,
  testLoginRequestAllowed,
} from "@/lib/test-login";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("test login", () => {
  it("is available automatically during local development", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("ENABLE_TEST_LOGIN", "");

    expect(testLoginEnabled()).toBe(true);
    expect(testLoginRequestAllowed("http://127.0.0.1:3000/api/auth/dev-login")).toBe(true);
  });

  it("can be explicitly enabled for a local production build", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_TEST_LOGIN", "1");

    expect(testLoginEnabled()).toBe(true);
    expect(testLoginRequestAllowed("http://localhost:3000/api/auth/dev-login")).toBe(true);
  });

  it("never allows the shortcut on a non-loopback host", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_TEST_LOGIN", "1");

    expect(testLoginRequestAllowed("https://tools.rftransparent.ca/api/auth/dev-login")).toBe(false);
  });

  it("stays disabled in production unless explicitly enabled", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("ENABLE_TEST_LOGIN", "");

    expect(testLoginEnabled()).toBe(false);
    expect(testLoginRequestAllowed("http://127.0.0.1:3000/api/auth/dev-login")).toBe(false);
  });

  it("recognizes only exact loopback hostnames", () => {
    expect(isLoopbackHostname("localhost")).toBe(true);
    expect(isLoopbackHostname("127.0.0.1")).toBe(true);
    expect(isLoopbackHostname("[::1]")).toBe(true);
    expect(isLoopbackHostname("localhost.example.com")).toBe(false);
  });
});

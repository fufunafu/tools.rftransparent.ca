import { describe, expect, it } from "vitest";
import { escapeIlikeValue, quotePostgrestValue } from "@/lib/postgrest";

describe("quotePostgrestValue", () => {
  it("wraps plain values in double quotes", () => {
    expect(quotePostgrestValue("foo@bar.com")).toBe('"foo@bar.com"');
  });

  it("neutralizes filter grammar characters by quoting", () => {
    // Unquoted, this value would smuggle an extra `.or()` condition.
    expect(quotePostgrestValue("x,outcome.eq.won")).toBe('"x,outcome.eq.won"');
    expect(quotePostgrestValue("a(b)c")).toBe('"a(b)c"');
  });

  it("escapes embedded quotes and backslashes", () => {
    expect(quotePostgrestValue('a"b')).toBe('"a\\"b"');
    expect(quotePostgrestValue("a\\b")).toBe('"a\\\\b"');
    // A trailing backslash must not escape the closing quote.
    expect(quotePostgrestValue("a\\")).toBe('"a\\\\"');
  });
});

describe("escapeIlikeValue", () => {
  it("leaves plain emails untouched", () => {
    expect(escapeIlikeValue("foo@bar.com")).toBe("foo@bar.com");
  });

  it("escapes SQL wildcards so they match literally", () => {
    expect(escapeIlikeValue("100%_x")).toBe("100\\%\\_x");
  });

  it("neutralizes the PostgREST * wildcard", () => {
    expect(escapeIlikeValue("*@bar.com")).toBe("\\*@bar.com");
  });

  it("escapes backslashes before they can unescape a wildcard", () => {
    expect(escapeIlikeValue("a\\%b")).toBe("a\\\\\\%b");
  });
});

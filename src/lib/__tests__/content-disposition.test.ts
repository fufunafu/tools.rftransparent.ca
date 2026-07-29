import { describe, it, expect } from "vitest";

// Mirrors the helper in src/app/api/bugs/attachments/[id]/route.ts. Kept here
// because the route module pulls in Supabase/auth on import; the header
// building is pure and is the part that broke in production.
function contentDisposition(filename: string | null): string {
  const name = filename ?? "screenshot";
  const ascii = name.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "");
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** What a header value must satisfy or the response throws at send time. */
function isByteString(value: string): boolean {
  return [...value].every((c) => c.charCodeAt(0) <= 255);
}

describe("attachment Content-Disposition", () => {
  // The exact name macOS gives a screenshot: U+202F (narrow no-break space)
  // sits before "PM". Serving this 500'd with "Cannot convert argument to a
  // ByteString because the character at index 50 has a value of 8239".
  const MACOS_SCREENSHOT = "Screenshot 2026-07-29 at 2.54.04\u202FPM.png";

  it("survives a macOS screenshot name", () => {
    const header = contentDisposition(MACOS_SCREENSHOT);
    expect(isByteString(header)).toBe(true);
    expect(header).toContain('filename="Screenshot 2026-07-29 at 2.54.04_PM.png"');
    expect(header).toContain("filename*=UTF-8''");
  });

  it("keeps every header byte in latin-1 range for assorted names", () => {
    const names = [
      MACOS_SCREENSHOT,
      "Capture d'écran 2026-07-29.png",
      "截图-2026.png",
      "emoji 🐛 bug.png",
      'quote".png',
      "back\\slash.png",
      null,
    ];
    for (const name of names) {
      expect(isByteString(contentDisposition(name))).toBe(true);
    }
  });

  it("strips quotes and backslashes that would break out of the quoted string", () => {
    const header = contentDisposition('a"b\\c.png');
    expect(header).toContain('filename="abc.png"');
  });

  it("round-trips the real name through filename*", () => {
    const header = contentDisposition(MACOS_SCREENSHOT);
    const encoded = header.split("filename*=UTF-8''")[1];
    expect(decodeURIComponent(encoded)).toBe(MACOS_SCREENSHOT);
  });
});

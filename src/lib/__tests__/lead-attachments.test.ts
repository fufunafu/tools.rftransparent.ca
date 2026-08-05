import { describe, expect, it } from "vitest";
import {
  attachmentContentDisposition,
  attachmentContentType,
  parsePendingAttachments,
  safeAttachmentName,
  validateAttachmentMetadata,
} from "@/lib/customer-service/lead-attachments";

describe("lead attachment validation", () => {
  it("accepts supported drawing formats", () => {
    expect(attachmentContentType("drawing.pdf", "application/pdf")).toBe("application/pdf");
    expect(attachmentContentType("photo.HEIC", "")).toBe("image/heic");
    expect(attachmentContentType("plan.jpeg", "application/octet-stream")).toBe("image/jpeg");
  });

  it("rejects unsupported files and oversized drawings", () => {
    expect(attachmentContentType("drawing.svg", "image/svg+xml")).toBeNull();
    expect(validateAttachmentMetadata({
      filename: "drawing.pdf",
      content_type: "application/pdf",
      size_bytes: 20 * 1024 * 1024 + 1,
    })).toMatchObject({ ok: false });
  });

  it("only accepts generated incoming paths", () => {
    const valid = {
      path: "incoming/96ab61a4-4c2a-4ee9-8309-1c69f1e6de6c-drawing.pdf",
      field_name: "file-1",
      filename: "drawing.pdf",
      content_type: "application/pdf",
      size_bytes: 2048,
    };

    expect(parsePendingAttachments([valid])).toEqual([valid]);
    expect(parsePendingAttachments([{ ...valid, path: "../drawing.pdf" }])).toEqual([]);
  });

  it("sanitizes storage and response header filenames", () => {
    expect(safeAttachmentName("../../Project Drawing (final).pdf")).toBe(".._.._Project_Drawing_final_.pdf");
    const disposition = attachmentContentDisposition('Plan 🏠 "final".pdf');
    expect(disposition).toContain('filename="Plan _ final.pdf"');
    expect(disposition).toContain("filename*=UTF-8''Plan%20%F0%9F%8F%A0%20%22final%22.pdf");
    expect(attachmentContentDisposition("drawing.svg", "attachment"))
      .toContain('attachment; filename="drawing.svg"');
  });
});

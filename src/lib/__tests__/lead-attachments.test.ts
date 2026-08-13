import { describe, expect, it } from "vitest";
import {
  attachmentContentDisposition,
  attachmentResponseDisposition,
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
    expect(attachmentContentType("animation.gif", "image/gif")).toBe("image/gif");
    expect(attachmentContentType("drawing.svg", "image/svg+xml")).toBe("image/svg+xml");
    expect(attachmentContentType("drawing.SVG", "application/octet-stream")).toBe("image/svg+xml");
  });

  it("rejects unsupported files and oversized drawings", () => {
    expect(attachmentContentType("drawing.exe", "application/octet-stream")).toBeNull();
    expect(validateAttachmentMetadata({
      filename: "drawing.pdf",
      content_type: "application/pdf",
      size_bytes: 20 * 1024 * 1024 + 1,
    })).toMatchObject({ ok: false });
  });

  it("accepts GIF and SVG upload metadata", () => {
    expect(validateAttachmentMetadata({
      filename: "animation.gif",
      content_type: "image/gif",
      size_bytes: 2048,
    })).toMatchObject({ ok: true, contentType: "image/gif" });
    expect(validateAttachmentMetadata({
      filename: "drawing.svg",
      content_type: "image/svg+xml",
      size_bytes: 4096,
    })).toMatchObject({ ok: true, contentType: "image/svg+xml" });
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

  it("forces SVG drawings to download instead of rendering inline", () => {
    expect(attachmentResponseDisposition("drawing.svg", "image/svg+xml", false))
      .toBe("attachment");
    expect(attachmentResponseDisposition("drawing.svg", "application/octet-stream", false))
      .toBe("attachment");
    expect(attachmentResponseDisposition("photo.gif", "image/gif", false))
      .toBe("inline");
    expect(attachmentResponseDisposition("photo.gif", "image/gif", true))
      .toBe("attachment");
  });
});

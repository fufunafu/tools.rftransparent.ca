import { describe, expect, it } from "vitest";
import { companyDomain, projectCrmImages, recordCompanyDomain, recordImageSources, savedCrmImage } from "./record-images.mjs";

describe("CRM record images", () => {
  it("uses the saved photo, then company logo, then the company's own icon", () => {
    const photo = "https://40088916.fs1.hubspotusercontent-na1.net/hubfs/40088916/photo.jpeg";
    const logo = "https://na1.hubspot-logos.com/company-logo";
    expect(recordImageSources({ object_type: "contacts", view_fields: { avatar_url: photo, logo_url: logo, email: "sales@builder.ca" } })).toEqual([photo, logo, "https://builder.ca/favicon.ico", "https://builder.ca/apple-touch-icon.png"]);
  });
  it("never uses a personal mailbox provider as the customer's company image", () => {
    for (const domain of ["gmail.com", "hotmail.ca", "outlook.fr", "yahoo.co.uk", "icloud.com", "shaw.ca"])
      expect(recordImageSources({ object_type: "contacts", view_fields: { email: `person@${domain}` } })).toEqual([]);
    expect(recordCompanyDomain({ object_type: "contacts", view_fields: { email: "person@gmail.com", website: "https://www.builder.ca/contact" } })).toBe("builder.ca");
  });
  it("rejects local addresses, credentials, non-web URLs and untrusted saved images", () => {
    for (const domain of ["localhost", "127.0.0.1", "2130706433", "[::1]", "printer.local", "x.internal", "https://user:secret@builder.ca", "javascript:alert(1)", "builder.ca:8080"])
      expect(companyDomain(domain)).toBeNull();
    for (const url of ["http://na1.hubspot-logos.com/logo", "https://na1.hubspot-logos.com.evil.example/logo", "https://user:password@na1.hubspot-logos.com/logo", "data:image/svg+xml,<svg/>"])
      expect(savedCrmImage(url)).toBeNull();
  });
  it("retains source fields and only accepts uploaded images from the record's portal", () => {
    const properties = { hs_avatar_filemanager_key: "hubfs/40088916/photo.jpeg", hs_logo_url: "https://na1.hubspot-logos.com/logo", domain: "www.builder.ca" };
    const original = { ...properties };
    expect(projectCrmImages(properties, "40088916")).toMatchObject({ avatar_url: "https://40088916.fs1.hubspotusercontent-na1.net/hubfs/40088916/photo.jpeg", logo_url: "https://na1.hubspot-logos.com/logo" });
    expect(projectCrmImages(properties, "2").avatar_url).toBe("");
    expect(projectCrmImages({ hs_avatar_filemanager_key: "hubfs/40088916/../other.jpeg" }, "40088916").avatar_url).toBe("");
    expect(properties).toEqual(original);
  });
});

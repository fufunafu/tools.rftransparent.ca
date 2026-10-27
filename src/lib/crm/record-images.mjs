const MAIL_PROVIDERS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com",
  "icloud.com", "me.com", "mac.com", "aol.com", "aim.com", "proton.me", "protonmail.com", "pm.me",
  "fastmail.com", "hey.com", "mail.com", "gmx.com", "gmx.de", "web.de", "yandex.com", "yandex.ru",
  "mail.ru", "inbox.ru", "bk.ru", "list.ru", "qq.com", "163.com", "126.com", "naver.com", "hanmail.net",
  "rogers.com", "bell.net", "sympatico.ca", "shaw.ca", "telus.net", "videotron.ca", "cogeco.ca",
  "comcast.net", "verizon.net", "att.net", "sbcglobal.net", "earthlink.net", "btinternet.com", "orange.fr",
  "wanadoo.fr", "laposte.net", "free.fr", "sfr.fr", "t-online.de", "telenet.be",
]);

export function companyDomain(value) {
  if (typeof value !== "string" || !value.trim() || value.length > 1000) return null;
  try {
    const url = new URL(value.includes("://") ? value.trim() : `https://${value.trim()}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port) return null;
    if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(host)) return null;
    if (/\.(?:local|localhost|internal|test|invalid|example|onion)$/.test(host)) return null;
    if (MAIL_PROVIDERS.has(host) || /^(?:yahoo|hotmail|outlook|live|gmx)\./.test(host)) return null;
    return host;
  } catch { return null; }
}

export function savedCrmImage(value) {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    const trusted = /^(?:na|eu)\d+\.hubspot-logos\.com$/.test(url.hostname)
      || /^(?:[a-z0-9-]+\.)*(?:hubspotusercontent(?:-[a-z0-9]+)?\.(?:net|com)|hubspotusercontent\d+\.net|hubspot\.net)$/.test(url.hostname);
    return trusted ? url.toString() : null;
  } catch { return null; }
}

export function projectCrmImages(properties, portalId) {
  const key = properties.hs_avatar_filemanager_key;
  const uploaded = /^\d+$/.test(portalId ?? "") && typeof key === "string"
    && key.startsWith(`hubfs/${portalId}/`) && !key.includes("..") && /^[a-zA-Z0-9_./-]+$/.test(key)
    ? `https://${portalId}.fs1.hubspotusercontent-na1.net/${key}` : null;
  return {
    avatar_url: savedCrmImage(uploaded) || "",
    logo_url: savedCrmImage(properties.hs_logo_url) || "",
    website: String(properties.website || "").slice(0, 500),
  };
}

/** @param {{object_type: string, view_fields?: Record<string, string>}} record */
export function recordCompanyDomain(record) {
  const fields = record.view_fields ?? {};
  const explicit = companyDomain(fields.domain) || companyDomain(fields.website);
  if (explicit) return explicit;
  const email = fields.email?.trim();
  return record.object_type === "contacts" && email && /^[^\s<>@,;]+@[^\s<>@,;]+$/.test(email)
    ? companyDomain(email.split("@")[1]) : null;
}

/** @param {{object_type: string, view_fields?: Record<string, string>}} record */
export function recordImageSources(record) {
  if (!["contacts", "companies"].includes(record.object_type)) return [];
  const fields = record.view_fields ?? {};
  const domain = recordCompanyDomain(record);
  return [...new Set([
    savedCrmImage(fields.avatar_url), savedCrmImage(fields.logo_url),
    // Load the company's own icon directly, without sending contact emails to
    // an image lookup service or fetching arbitrary websites from our server.
    domain ? `https://${domain}/favicon.ico` : null,
    domain ? `https://${domain}/apple-touch-icon.png` : null,
  ].filter(Boolean))];
}

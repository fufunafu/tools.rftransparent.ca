import { Resend } from "resend";

let _resend: Resend | null = null;

interface ResendApiResponse {
  code?: string;
  name?: string;
  data?: Array<{ name?: string; status?: string }>;
}

export function getResend(): Resend {
  if (!_resend) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("Missing RESEND_API_KEY env var");
    _resend = new Resend(key);
  }
  return _resend;
}

export async function checkResendHealth(): Promise<string> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("Not configured");

  const response = await fetch("https://api.resend.com/domains", {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "User-Agent": "rf-tools-health-check/1.0",
    },
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => null)) as ResendApiResponse | null;

  if (!response.ok) {
    // A sending-access key is valid but cannot read account resources. Resend
    // identifies that permission boundary separately from an invalid API key.
    if (
      response.status === 401 &&
      (payload?.name === "restricted_api_key" || payload?.code === "restricted_api_key")
    ) {
      return "Sending access key accepted";
    }
    throw new Error(`HTTP ${response.status}`);
  }

  const sender = payload?.data?.find((domain) => domain.name === "rftransparent.ca");
  if (!sender) throw new Error("rftransparent.ca not found in Resend domains");
  if (sender.status !== "verified") {
    throw new Error(`rftransparent.ca is ${sender.status ?? "unverified"}`);
  }
  return "rftransparent.ca verified";
}

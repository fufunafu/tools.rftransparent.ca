import nextEnv from "@next/env";

// Sandbox credentials are deliberately separate from the production uploader.
nextEnv.loadEnvConfig(process.cwd(), true);

async function verify() {
  const keys = ["AMAZON_SANDBOX_CLIENT_ID", "AMAZON_SANDBOX_CLIENT_SECRET", "AMAZON_SANDBOX_REFRESH_TOKEN"];
  const missing = keys.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Missing sandbox configuration: ${missing.join(", ")}`);

  const authorization = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.AMAZON_SANDBOX_CLIENT_ID,
      client_secret: process.env.AMAZON_SANDBOX_CLIENT_SECRET,
      refresh_token: process.env.AMAZON_SANDBOX_REFRESH_TOKEN,
    }),
  });
  if (!authorization.ok) throw new Error(`Sandbox authorization failed (HTTP ${authorization.status}).`);
  const token = await authorization.json();
  if (typeof token.access_token !== "string") throw new Error("Amazon returned no sandbox access token.");

  // Fixed GET request to Amazon's static fixture, never a real seller or product.
  // Official fixture: amzn/selling-partner-api-models, listingsItems_2021-08-01.json.
  const endpoint = "https://sandbox.sellingpartnerapi-na.amazon.com";
  const response = await fetch(`${endpoint}/listings/2021-08-01/items/TEST_SELLER/GM-ZDPI-9B4E?marketplaceIds=ATVPDKIKX0DER&includedData=summaries,issues`, {
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: { "x-amz-access-token": token.access_token, "User-Agent": "RF-Tools-Sandbox/1.0", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Sandbox Listings request failed (HTTP ${response.status}).`);
  const listing = await response.json();
  if (listing.sku !== "GM-ZDPI-9B4E" || listing.summaries?.[0]?.asin !== "B071VG5N9D") {
    throw new Error("Sandbox response did not match Amazon's expected static listing fixture.");
  }
  console.log(JSON.stringify({
    checkedAt: new Date().toISOString(),
    environment: "sandbox",
    endpoint,
    authorization: "passed",
    getListingsItem: "passed",
    httpStatus: response.status,
    fixtureMatched: true,
    productionRequests: 0,
    listingsSubmitted: 0,
  }, null, 2));
}

verify().catch((error) => {
  // Do not print response bodies, request headers, tokens, or nested error causes.
  const message = error instanceof Error && /^(Missing sandbox configuration:|Sandbox |Amazon returned no sandbox)/.test(error.message)
    ? error.message : "Sandbox verification failed because of a network or response error.";
  console.error(message);
  process.exitCode = 1;
});

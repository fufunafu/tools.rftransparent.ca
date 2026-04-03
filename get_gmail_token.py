"""
Generate Gmail OAuth refresh token for email tracking.

HOW TO USE:
1. Run: python3 get_gmail_token.py
2. Open the URL it prints in your browser
3. Log in with the Gmail account you want to authorize
4. After authorizing, the browser redirects to localhost (page won't load - that's OK)
5. Copy the FULL URL from the address bar and paste it into the terminal
6. The script prints the refresh token — save it

WHERE TO SAVE THE TOKEN:
- info@glass-railing.com    → GMAIL_REFRESH_TOKEN_RF   (in .env.local + Vercel)
- info@glassrailingstore.com → GMAIL_REFRESH_TOKEN_GRS  (in .env.local + Vercel)
- anne@cloture-verre.com     → GMAIL_REFRESH_TOKEN_BC   (in .env.local + Vercel)

PREREQUISITES:
- Google Cloud project "fuanne-com-scraper" must have OAuth consent screen set to External + In Production
- http://localhost must be in Authorized redirect URIs (Google Cloud Console → Credentials → OAuth Client)
- Tokens from production apps don't expire (unlike testing mode which expires after 7 days)
"""
import urllib.parse, urllib.request, json, os

CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "")
CLIENT_SECRET = os.environ.get("GOOGLE_CLIENT_SECRET", "")
if not CLIENT_ID or not CLIENT_SECRET:
    print("ERROR: Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET env vars first")
    exit(1)
SCOPES = "https://www.googleapis.com/auth/gmail.readonly"
REDIRECT = "http://localhost"

auth_url = (
    f"https://accounts.google.com/o/oauth2/v2/auth"
    f"?client_id={CLIENT_ID}"
    f"&redirect_uri={REDIRECT}"
    f"&response_type=code"
    f"&scope={SCOPES}"
    f"&access_type=offline"
    f"&prompt=consent"
)

print("\n=== Open this URL in your browser ===")
print(auth_url)
print("\nAfter authorizing, the browser redirects to localhost (page won't load - that's OK).")
print("Copy the FULL URL from the address bar and paste it below.\n")

url = input("Paste the full redirect URL here: ").strip()

code = urllib.parse.parse_qs(urllib.parse.urlparse(url).query).get("code", [""])[0]
if not code:
    print("ERROR: Could not extract code from URL")
    exit(1)

data = urllib.parse.urlencode({
    "code": code,
    "client_id": CLIENT_ID,
    "client_secret": CLIENT_SECRET,
    "redirect_uri": REDIRECT,
    "grant_type": "authorization_code",
}).encode()

req = urllib.request.Request("https://oauth2.googleapis.com/token", data=data)
resp = urllib.request.urlopen(req)
result = json.loads(resp.read())

print(f"\n=== REFRESH TOKEN ===")
print(result["refresh_token"])
print("\nRun this script again for the next account.")

# RF Tools iOS app

The `ios/` folder is a native iOS app (built with Capacitor) that wraps the
live site. The app loads **https://tools.rftransparent.ca** directly, so every
normal Vercel deploy updates the app instantly — you only rebuild and resubmit
the app when you change something in `ios/` or `capacitor.config.json` itself.

## How the pieces fit

- `capacitor.config.json` — app name ("RF Tools"), bundle id
  (`ca.rftransparent.tools`), and the URL the app loads.
- `capacitor/www/` — a tiny placeholder page bundled into the app; users only
  ever see it if the site is unreachable.
- `ios/` — the actual Xcode project. The app icon lives at
  `ios/App/App/Assets.xcassets/AppIcon.appiconset/`.
- `src/app/manifest.ts` + icons — separate from the native app: these let
  anyone also install the site straight from Safari via Share →
  **Add to Home Screen** (no App Store involved). Good fallback while
  TestFlight is being set up.

## Working on the app locally

Open the project in Xcode:

```sh
open ios/App/App.xcodeproj
```

Run in the Simulator: pick any iPhone in the device dropdown and press ▶.
No Apple account needed for the Simulator.

After editing `capacitor.config.json` or `capacitor/www/`, sync them into the
iOS project before building:

```sh
npx cap copy ios
```

## Getting it onto employees' phones (TestFlight)

One-time setup, roughly 1–2 hours of clicking plus Apple wait times:

1. **Enroll in the Apple Developer Program** ($99 USD/yr) at
   https://developer.apple.com/programs/enroll/ using the company Apple ID.
   Approval usually takes a day or two.
2. **Xcode signing**: open the project, select the **App** target →
   *Signing & Capabilities* → check "Automatically manage signing" and pick
   your team.
3. **Create the app record** at https://appstoreconnect.apple.com →
   My Apps → "+" → New App. Bundle ID `ca.rftransparent.tools`,
   name "RF Tools".
4. **Upload a build**: in Xcode, set the device to "Any iOS Device", then
   *Product → Archive*, then *Distribute App → TestFlight & App Store*.
5. **Invite employees**: in App Store Connect → TestFlight → Internal Testing,
   add testers by email (up to 100). They install the free **TestFlight** app
   and tap the invite link — done.

Notes:

- TestFlight builds expire after 90 days, so re-upload a build a few times a
  year (steps 4–5 only; takes ~10 minutes).
- If you'd rather not re-upload, the alternative is **unlisted App Store
  distribution** (a permanent App Store link that isn't publicly searchable):
  https://developer.apple.com/support/unlisted-app-distribution/ — requires
  passing App Review once.
- Google sign-in may be blocked inside the app's web view
  ("disallowed_useragent"); employees should use the **email + password**
  option on the login screen instead.

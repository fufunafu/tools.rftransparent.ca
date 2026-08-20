# RF Tools iOS app

The `ios/` folder is a native iOS app (built with Capacitor) that wraps the
live site. The app loads **https://tools.rftransparent.ca** directly, so every
normal Vercel deploy updates the app instantly. Rebuild and resubmit the app
when native code, native dependencies, or the Capacitor configuration changes.

## How the pieces fit

- `capacitor.config.ts`: app name ("RF Tools"), bundle id
  (`ca.rftransparent.tools`), environment-safe server URL, and native plugin
  settings.
- `capacitor/www/`: bundled loading and offline recovery pages.
- `ios/`: the actual Xcode project. The app icon lives at
  `ios/App/App/Assets.xcassets/AppIcon.appiconset/`.
- `src/app/manifest.ts` and icons: separate from the native app. These support
  Safari's Add to Home Screen flow.

## Working on the app locally

Open the project in Xcode:

```sh
open ios/App/App.xcodeproj
```

Run in the Simulator: pick any iPhone in the device dropdown and press ▶.
No Apple account needed for the Simulator.

Use the explicit sync command for the build you intend to create:

```sh
npm run cap:sync:dev
npm run cap:sync:prod
```

The development command permits cleartext traffic only to
`http://127.0.0.1:3000`. The production command forces
`https://tools.rftransparent.ca`, rejects local or cleartext settings, and
validates the generated iOS configuration.

Run a simulator build with:

```sh
npm run ios:build:sim
```

Before TestFlight, follow `docs/ios-testflight-rollout.md` and run the full
release gate documented there.

## Getting it onto employees' phones (TestFlight)

One-time setup, roughly 1 to 2 hours of configuration plus Apple wait times:

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
   and tap the invite link.

Notes:

- TestFlight builds expire after 90 days, so re-upload a build a few times a
  year. Repeat steps 4 and 5 only.
- If you'd rather not re-upload, the alternative is **unlisted App Store
  distribution** (a permanent App Store link that isn't publicly searchable):
  https://developer.apple.com/support/unlisted-app-distribution/ — requires
  passing App Review once.
- Google sign-in may be blocked inside the app's web view
  ("disallowed_useragent"); employees should use the **email + password**
  option on the login screen instead.

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
- `ios/App/App/Application/`: native app boundaries. Appearance, the Capacitor
  bridge, external-navigation policy, and the background privacy shield are
  kept separate from scene lifecycle wiring.
- `ios/App/project.yml`: reproducible XcodeGen definition for the app, native
  unit-test target, UI-test target, shared scheme, and release guard.
- `ios/App/AppTests/` and `ios/App/AppUITests/`: native policy, privacy,
  notification-category, launch, and lifecycle coverage.
- `src/components/NativeAppRuntime.tsx`: web-side native lifecycle, connection,
  Face ID session gate, foreground refresh, and support diagnostics. The
  bundled load-error page also persists a privacy-safe WebView failure count
  through the native support bridge. That bridge also checks the fixed public
  service-status endpoint so the bundled page can distinguish planned
  maintenance from an unexpected load failure without relying on the remote
  WebView.
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

Run the complete native suite with:

```sh
npm run ios:test:native
```

This command runs the native-focused Vitest coverage for authentication,
location, push, links, updates, diagnostics, and clock policy, then runs the
XCTest and XCUITest targets on an iPhone Simulator and the XCUITest target on
an iPad Simulator.

The mobile browser release gate runs the complete authenticated workflow on a
reference iPhone and the signed-in daily shell across iPhone SE, standard
iPhone, Pro Max, iPad, and supported landscape viewports. It serializes those
checks so repeated server-side session validation does not overload the
authentication service.

Set `IOS_TEST_DEVICE` or `IOS_SIMULATOR_UDID` to select a specific simulator.
The default runner prefers an iPhone 17 and otherwise selects an available
iPhone. Set `IOS_TEST_FAMILY=ipad` to select an available iPad without relying
on one simulator generation being installed. Run `npm run ios:test:ui:ipad`
for the dedicated iPad native UI gate used by CI.

The runner keeps DerivedData in the operating system temporary directory so
simulator signing is not affected when the repository is stored in iCloud
Drive. Set `IOS_DERIVED_DATA_PATH` only when a different local cache location
is required. Each Xcode operation is limited to five minutes so a stalled
CoreSimulator process is retried instead of hanging CI indefinitely. Set
`IOS_TEST_OPERATION_TIMEOUT_MS` to an integer of at least 30000 only when a
slower runner needs a different bound. CI retains failed `.xcresult` bundles
from its runner temporary directory.

## Universal links, notifications, and updates

- Associated Domains uses `applinks:tools.rftransparent.ca`. Keep both
  `public/apple-app-site-association` files aligned with the allowlist in
  `src/lib/native-links.ts`. Time-limited links may include one `exp` Unix
  timestamp or one `expires`/`expires_at` timestamp. Invalid, duplicate, or
  elapsed expirations return the employee safely to Home.
- Apply `20260824153000_push_preferences.sql` before enabling notification
  preferences. Push copy must remain generic and must not contain customer,
  employee, credential, location, or session details.
- Debug device builds use the APNs sandbox entitlement. Release, TestFlight,
  and App Store builds use the production entitlement. Registration stores the
  environment with each token so the sender can use the matching Apple gateway
  when both build types are active.
- Configure `IOS_MINIMUM_BUILD`, `IOS_RECOMMENDED_BUILD`,
  `IOS_CURRENT_VERSION`, and `IOS_UPDATE_URL` in the deployed environment.
  If build policy variables are temporarily absent, the endpoint safely keeps
  build 1 compatible and recommends the current native build.
  `IOS_UPDATE_URL` must be the approved HTTPS TestFlight or unlisted App Store
  destination. A build below the minimum remains blocked if that URL is
  missing or invalid and shows a support recovery action instead of exposing
  an unsafe destination.
- Set `IOS_MAINTENANCE_MODE=1` and optionally `IOS_MAINTENANCE_MESSAGE` for a
  planned outage. The native app shows a blocking maintenance state and never
  represents work as submitted.

Generate a signed archive with `npm run ios:archive`. After App Store Connect
credentials and signing are available, `npm run ios:testflight` archives and
uploads using `ios/App/ExportOptions.plist`.

A clock-status widget or Live Activity is intentionally deferred. The first
internal TestFlight group must validate server-confirmed clock-in, clock-out,
geofence recovery, offline blocking, and duplicate-tap behavior on real devices
before a background clock surface is designed or given additional entitlements.

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
   App Store name "RF Transparent Tools". The installed display name remains
   "RF Tools".
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

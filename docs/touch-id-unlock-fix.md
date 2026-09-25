# Touch ID unlock regression

Apple reported an immediate return to the locked screen in version 1.0 (3) on an iPad Air 11-inch (M3), iPadOS 27.0.

The production source at `c87aa0a628cc15f5e77960fef3151449394ef77b` treated Capacitor's `appStateChange(false)` as backgrounding. On iOS, that event corresponds to `UIApplication.willResignActiveNotification`, including temporary system authentication interruptions. Returning active then refreshed the app and could launch a second authentication request after a successful unlock. Earlier locally available recovery changes were absent from this production source.

The corrected runtime revokes the in-memory unlock only for Capacitor's `pause` event, which corresponds to `UIApplication.didEnterBackgroundNotification`. Authentication interruptions do not revoke a successful unlock or refresh the app. Real backgrounding still covers protected content and requires another unlock. A stale authentication result from before backgrounding cannot unlock the resumed session. Session requests and biometric callbacks have bounded waits; cancellation and failure retain retry and logout controls. Cleanup of obsolete stored credentials no longer blocks successful login or unlock.

This is a change to the hosted web runtime loaded by the existing native app. It does not change the native binary, biometric policy, account permissions, or device passcode fallback.

## Verification

The two new callback-order regression cases fail against the production source and pass with the correction. Additional coverage checks real backgrounding, late callbacks, cancellation, retries, and stalled requests. The runtime suite is included in `ios:native-smoke` and the full unit test run. Its browser environment and the existing picture migration test dependency are explicitly declared in the package manifest and lockfile so a clean CI install can run both suites.

Validated in an isolated checkout of the production source:

- 967 tests passed across 127 files.
- 199 native smoke tests passed, plus native shell validation.
- ESLint, TypeScript, and the Next.js production build passed.
- A clean dependency installation was checked using the release lockfile.

Automated lifecycle tests use the real React runtime component with mocked native callbacks. They do not establish successful physical Touch ID operation on iPadOS 27.0. An exact-device check remains required before describing that device as tested to App Review.

For the device check, fully close and reopen the app, sign in with the review account, unlock, navigate to Tasks, background and reopen the app, and unlock again. Also cancel authentication and verify that retry and logout remain available. Repeat after a fresh installation and an update when a new native build is submitted.

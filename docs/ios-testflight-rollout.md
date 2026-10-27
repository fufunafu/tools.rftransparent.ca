# RF Tools iOS TestFlight rollout

Use this checklist after the automated release gate succeeds. Test with a
non-production warehouse employee account and a small internal group before
expanding access.

## Automated gate

- [ ] Apply all pending Supabase migrations in the target environment.
- [ ] Confirm `IOS_UPDATE_URL` is the approved TestFlight or unlisted App Store
  destination and the deployed minimum and recommended build values are correct.
- [ ] Confirm `https://tools.rftransparent.ca/.well-known/apple-app-site-association`
  returns the committed association JSON without a redirect.
- [ ] Run `npm run ios:verify-deployment` after the production deployment. It
  verifies both association files, the full supported-link allowlist, native
  version policy, approved Apple update destination, and service status.
- [ ] Deploy the matching web commit to `https://tools.rftransparent.ca` and
  verify Login, Home, Clock, Tasks, More, and each frontline role route before
  archiving the native shell. The native app loads this live deployment.
- [ ] Create a fresh Playwright storage-state file for the warehouse test user.
- [ ] Run `npm run ios:release-check` with `E2E_MOBILE_STORAGE_STATE` and
  `E2E_MOBILE_DEPARTMENT=warehouse` set.
- [ ] Generate the archive privacy report in Xcode and confirm its data types,
  purposes, tracking status, and the app-only UserDefaults reason `CA92.1`
  match `app-store-assets/submission-metadata.md` and `PrivacyInfo.xcprivacy`.
- [ ] Confirm the embedded `ios/App/App/capacitor.config.json` contains
  `https://tools.rftransparent.ca`, does not contain a local host, and does not
  enable cleartext traffic.
- [ ] Run `npm run ios:export` and inspect the exported IPA before uploading.
  Confirm it has the production APNs entitlement, Associated Domains,
  `beta-reports-active`, and `get-task-allow` set to false.
- [ ] Start the built app locally with `ENABLE_TEST_LOGIN=1`, run
  `npm run ios:screenshots`, and review the generated iPhone 6.9-inch and iPad
  13-inch App Store screenshots before upload.
- [ ] Archive the Release configuration in Xcode without changing the generated
  Capacitor configuration after the gate.

## Internal TestFlight group

- [ ] Start with one representative from sales, warehouse, customer service,
  marketing, and management.
- [ ] Record the app version and build number tested.
- [ ] Confirm cold launch shows the branded surface without a black or blank
  frame.
- [ ] Confirm an offline cold launch shows connection status, Retry, and the
  support link after the bounded launch fallback.
- [ ] Open a supported universal link from Mail or Messages and confirm it opens
  the authorized app destination. Confirm unsupported, expired, and
  role-restricted links fall back safely to Home.
- [ ] Verify each notification preference, generic lock-screen copy, and tap
  destination for tasks, clock reminders, follow-ups, and callbacks.
- [ ] Temporarily exercise recommended-update, required-update, and maintenance
  policies against an internal test build.
- [ ] Share diagnostics from More and confirm they contain no password, token,
  session, customer, precise-location, or employee-content fields.
- [ ] Confirm a returning signed-in user must unlock with Face ID, Touch ID, or
  the device passcode.
- [ ] Cancel device authentication and confirm protected content stays covered.
- [ ] Background the app from a sensitive screen and confirm the app switcher
  shows the privacy cover.
- [ ] Return to the foreground and confirm data refreshes after unlock.
- [ ] Deny Location, recover it in iOS Settings, and confirm clock-in becomes
  available without reinstalling.
- [ ] Test an inaccurate location, an outside-geofence location, a boundary
  location, clock-in, a double tap, and clock-out.
- [ ] Confirm no clock or report action reports success while offline.
- [ ] Submit a warehouse report and confirm the signed-in employee identity is
  used without an employee picker.
- [ ] Open each department action from Home and confirm it reaches the personal
  frontline workflow.
- [ ] Open every external tool and confirm it leaves the authenticated WebView.
- [ ] Verify VoiceOver order and labels on Login, Home, Clock, Tasks, More, and
  the department workflow.
- [ ] Verify the largest supported Dynamic Type size, reduced motion, landscape,
  and all supported iPhone and iPad layouts.

## Expansion criteria

Expand beyond the internal group only when every item above passes on real
devices and there are no unresolved launch, authentication, clock, task,
warehouse identity, permission-recovery, or navigation defects. Keep the prior
TestFlight build available for rollback until the new build has completed the
internal observation period.

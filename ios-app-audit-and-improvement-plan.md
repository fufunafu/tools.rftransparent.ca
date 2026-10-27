# RF Tools iOS Improvement Plan

## Summary

The current app has a solid foundation: the mobile login is visually coherent, safe areas are handled, the bottom navigation is understandable, all 635 unit tests pass, and the native project builds successfully with Face ID, secure storage, and geolocation.

The audit found five priority problems:

- Release configuration currently points the packaged app at `http://localhost:3000`, despite documentation claiming production uses `https://tools.rftransparent.ca`.
- Cold launch briefly presents a blank black screen and has no useful offline or load-failure recovery.
- Passwords are stored in the device Keychain for Face ID login. Face ID should protect the existing Supabase session instead of releasing a saved account password.
- The warehouse report workflow lets authenticated users select another employee and submit or overwrite that employee's report.
- Mobile automation is minimal. There is no coverage for the mobile shell, native permissions, Face ID, geofencing, offline behavior, or app lifecycle.

The implementation will keep Capacitor and optimize frontline staff first. Desktop management dashboards will remain functional but will not receive a full mobile redesign in this phase.

## Implementation Changes

### 1. Release, native shell, and reliability

- Replace the single Capacitor configuration with environment-safe production and local-development modes. Production must default to the HTTPS production site, reject cleartext traffic, and fail the build if the embedded configuration contains localhost.
- Add explicit `cap:sync:dev`, `cap:sync:prod`, simulator-build, and release-validation scripts so the wrong server cannot be packaged accidentally.
- Hold the branded launch screen until the first web view is ready, replacing the current black cold-start surface.
- Add a native offline and load-failure state with Retry, connection status, and a support link. Clock actions remain online-only and must never show success until the server confirms them.
- Add app lifecycle handling for foreground refresh, keyboard resizing, status bar appearance, safe-area changes, and a privacy cover while the app is backgrounded.
- Restrict authenticated in-app navigation to the RF Tools domain. Open external tools in the system browser and show a clear external-link indicator.
- Display app version, build number, environment, and connection status in More for support diagnostics.

### 2. Authentication, permissions, and workforce security

- Stop storing raw account passwords. Use the normal persisted Supabase session for re-entry, place a Face ID gate over an existing native session on launch and resume, and require the password again only when the server session expires.
- Migrate safely by deleting any legacy saved credential after the first successful session-based unlock or manual sign-in.
- Add clear permission education immediately before requesting location. Handle allowed, denied, restricted, inaccurate, timed-out, and unavailable states with actionable messages.
- Complete the current geofence work by validating coordinate ranges, finite values, accuracy, capture time, configured radius, and duplicate submissions on the server.
- Extend the time-entry audit record with reported accuracy and capture time in addition to distance. Keep clock-out server-timestamped and allow no offline clock records.
- Bind warehouse report submission to the employee resolved from the authenticated email. Remove the employee picker for frontline users and reject client-supplied employee identities. Any manager correction workflow must use a separately authorized management action.
- Preserve server-side authorization as the source of truth. Navigation visibility remains a usability feature only.

### 3. Frontline information architecture and visual system

- Keep four primary tabs: Home, Clock, Tasks, and More.
- Turn Home into an action-oriented daily view containing clock state, overdue and due-today task counts, department-specific work, and clear exception states. Use one mobile home aggregation endpoint to avoid several delayed requests and inconsistent loading.
- Order role tools first in More, followed by shared tools, account, help, and management-only sections. Remove duplicate parent and child destinations.
- Add a contextual mobile header with page title and Back on detail screens. Tab roots retain the compact branded header.
- Standardize mobile surfaces around one token set for color, spacing, radius, type, status, empty states, skeletons, and feedback. Remove the current visual split between legacy `sand` styles and newer `slate` styles in frontline flows.
- Use native-feeling controls with 44-point minimum targets, readable tab labels, system text styles in the iOS wrapper, visible pressed states, and status communication that does not rely on color alone.
- Simplify frontline role destinations:
  - Sales opens an employee-focused sales and follow-up view, not the full reporting dashboard.
  - Warehouse opens personal daily reporting and operational shortcuts.
  - Customer service opens personal callbacks and follow-ups before aggregate analytics.
  - Marketing retains a compact campaign summary, with dense analysis treated as a secondary screen.
- Keep tables and manager analytics available, but present a mobile summary or card view before any horizontally scrolling table.

## Interfaces and Data Flow

- Add `GET /api/mobile/home` returning the authenticated employee profile, department, location, clock summary, task counts, and permitted role actions.
- Extend `POST /api/clock` location input to include latitude, longitude, accuracy, and capture timestamp. Return stable error codes for permission required, inaccurate fix, outside geofence, stale location, duplicate shift, stale shift, and server unavailable.
- Change warehouse report writes so employee identity is derived server-side. The frontline request contains only report date, production counts, and notes.
- Add shared client types for mobile bootstrap state, native runtime state, clock errors, and offline state. Components must render loading, empty, error, offline, and success states explicitly.
- Keep desktop and existing API consumers compatible where possible. Any management-only warehouse correction will use an explicitly separate interface rather than weakening the frontline endpoint.

## Test and Rollout Plan

- Add Playwright projects for WebKit at iPhone SE, standard iPhone, Pro Max, and iPad viewports.
- Cover login, session restoration, tab navigation, contextual back navigation, Home states, Tasks, More filtering, warehouse identity binding, and responsive overflow.
- Add clock tests for permission denial, inaccurate GPS, stale coordinates, boundary distances, spoofed or invalid numbers, offline attempts, double taps, stale shifts, and successful clock-in and clock-out.
- Add native smoke tests for cold launch, branded loading, offline launch, foreground refresh, privacy cover, Face ID success and cancellation, location permission changes, and external links.
- Run accessibility checks for VoiceOver labels, focus order, contrast, Dynamic Type behavior, reduced motion, 44-point targets, and error announcements.
- Require `npm run check`, production Capacitor configuration validation, `xcodebuild` simulator success, and the mobile end-to-end suite before TestFlight upload.
- Release through a small internal TestFlight group first. Verify launch reliability, login, clock accuracy, task completion, warehouse reporting, and permission recovery on real devices before expanding to all employees.

## Assumptions and Acceptance Criteria

- The current uncommitted geolocation and clock work is intentional and will be completed, not discarded.
- Capacitor remains the architecture, iOS 15 remains the minimum deployment target, and the live Next.js deployment remains the application backend.
- Frontline employee workflows receive first-class iPhone treatment. Full mobile redesigns of management analytics and purchasing are outside this phase.
- A successful release has no localhost production configuration, no black or blank failure screen, no stored raw password, no cross-employee warehouse submissions, and no unconfirmed offline clock actions.
- An employee can launch and unlock the app, understand clock status, clock in or out, find today's tasks, and reach their primary department workflow without opening More.

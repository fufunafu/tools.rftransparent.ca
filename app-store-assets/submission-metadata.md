# RF Transparent Tools App Store metadata

Use these values for iOS version 1.0. Keep reviewer credentials out of this
repository and enter them directly in App Store Connect.

## Product page

- Primary language: `English (Canada)`
- Bundle ID: `ca.rftransparent.tools`
- SKU: `rf-tools-ios`
- App name: `RF Transparent Tools`
- Subtitle: `Workforce operations`
- Primary category: `Business`
- Secondary category: `Productivity`
- Promotional text: `Clock in, manage tasks, submit warehouse reports, and stay connected to the RF Transparent workflows you use every day.`
- Keywords: `workforce,operations,tasks,time clock,warehouse,employee,productivity,team,workflow,reporting`
- Support URL: `https://tools.rftransparent.ca/support`
- Marketing URL: `https://rftransparent.ca/`
- Version: `1.0`
- Build: `3`
- Copyright: `2026 15041074 Canada Inc.`
- Price: `Free`
- Availability: `Canada`

### Description

RF Transparent Tools gives authorized RF Transparent employees a secure mobile
workspace for daily operations.

Use the app to:

- View a personalized home dashboard
- Clock in and out with workplace location verification
- Manage assigned tasks and due dates
- Submit warehouse reports
- Access role-based sales, warehouse, customer service, marketing, purchasing,
  accounting, and management tools
- Receive operational reminders and updates

Access is limited to accounts provided by RF Transparent. Available features
depend on each employee's role and permissions. Location is requested only when
clocking in and is not continuously tracked.

## General information

- Content rights: Yes. The app accesses company-authorized content from
  connected business systems, and RF Transparent has the necessary rights.
- Age rating features: No for parental controls, age assurance, unrestricted
  web access, broadly distributed user-generated content, social media,
  messaging and chat, and advertising.
- Age rating content: None for every mature-content, medical, sexuality,
  violence, and chance-based activity category.
- Encryption: No non-exempt encryption. `ITSAppUsesNonExemptEncryption` is
  already `false` in the iOS app.
- Release: Automatically release after approval.
- Game Center: No.
- In-app purchases: None.
- Expected age rating: `4+`.
- Updated age-rating questionnaire:
  - In-app controls: No parental controls and no age assurance.
  - Capabilities: No unrestricted web access, broadly distributed
    user-generated content, social media, messaging or chat, or advertising.
  - Mature themes, medical or wellness content, sexuality or nudity, violence,
    and chance-based activities: None.

## App privacy

- Privacy policy URL: `https://tools.rftransparent.ca/privacy`
- Tracking: No.
- The app-level `PrivacyInfo.xcprivacy` mirrors these answers and is included in
  the native target. Generate the archive privacy report before upload and
  confirm the aggregate report remains consistent with this section.
- Data linked to the user's identity and used only for App Functionality:
  - Contact Info: Name, Email Address
  - Location: Precise Location
  - User Content: Photos or Videos, Customer Support, Other User Content
  - Identifiers: User ID, Device ID
- Do not declare third-party advertising, developer advertising, analytics,
  product personalization, or unrelated tracking purposes.

The broad declaration is intentional. RF Tools handles employee profiles,
attendance, tasks, reports, surveys, reimbursements, bug reports, attachments,
operational activity, and push tokens. Do not declare data that is only displayed
from an existing company system and is not transmitted from the app.

## Accessibility

Reduced Motion is implemented globally and can be declared after its automated
mobile test passes. Do not declare VoiceOver, Voice Control, Larger Text,
Differentiate Without Color Alone, or Sufficient Contrast until the complete
app has been verified on a real device against Apple's support criteria.
Captions and Audio Descriptions do not apply because the app has no video or
audio content.

## App Review

- Contact first name: `Fuanne`
- Contact last name: `Gao`
- Contact phone: `+1 416 613 4388`
- Contact email: `info@glass-railing.com`
- Sign-in required: Yes
- Review account: Create a dedicated active warehouse employee account with a
  password, then enter it directly in App Store Connect.

## Screenshot upload

- iPhone 6.9-inch: upload the four JPEG files in
  `app-store-assets/screenshots/iphone-6.9/` in filename order. Each file is
  1320 by 2868 pixels.
- iPad 13-inch: upload the four JPEG files in
  `app-store-assets/screenshots/ipad-13/` in filename order. Each file is 2064
  by 2752 pixels.
- App preview video: None.

### Review notes

RF Transparent Tools is a private workforce application for authorized RF
Transparent employees. A review account is provided above and opens the
warehouse employee experience. The app is intended for unlisted distribution
because it serves a limited employee audience on managed and unmanaged devices.

Suggested review path:

1. Sign in with the supplied review account.
2. Use Home to view the employee's clock status, tasks, and role actions.
3. Open Clock. The app requests location only after Clock In is tapped. The
   reviewer may allow location or cancel the action without affecting the rest
   of the app.
4. Open Tasks to review task creation, due-date filters, and completion.
5. Open More for connection status, app version, support, privacy, and sign out.
6. Open Daily report from Home to review the warehouse workflow. The signed-in
   employee is selected automatically.

Push notifications are optional. Face ID, Touch ID, or the device passcode is
used only to unlock a returning signed-in native-app session. No credentials
are stored by the app. External web links open outside the authenticated app
view. If a live integration is unavailable during review, the related screen
shows its current availability while the core Home, Clock, Tasks, More, and
warehouse flows remain available.

## Distribution decision

Keep the App Store Connect distribution method set to Public, submit version
1.0 to App Review, and request unlisted app distribution at the same time.
Apple identifies employee-resource apps used on managed and unmanaged devices
as suitable for an unlisted link. If the unlisted request is approved, Apple
changes the app from Public to Unlisted while keeping the same app record.

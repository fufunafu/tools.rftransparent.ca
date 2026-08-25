import XCTest

final class RFAppUITests: XCTestCase {
    override func setUpWithError() throws {
        continueAfterFailure = false
    }

    func testColdLaunchCreatesBrandedNativeRootAndWebView() {
        let app = XCUIApplication()
        app.launch()
        let brandedRoot = app.descendants(matching: .any)["rf-native-root"]
        XCTAssertTrue(brandedRoot.waitForExistence(timeout: 10))
        XCTAssertEqual(brandedRoot.label, "RF Tools branded loading view")
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
    }

    func testAppRecoversAfterBackgroundLifecycle() {
        let app = XCUIApplication()
        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))
        XCUIDevice.shared.press(.home)
        app.activate()
        XCTAssertTrue(app.wait(for: .runningForeground, timeout: 10))
        XCTAssertTrue(app.webViews.firstMatch.exists)
    }

    func testReturningToForegroundRequestsFreshContent() {
        let app = launchScenario("foreground-refresh")
        XCTAssertTrue(app.staticTexts["Initial content loaded."].exists)

        XCUIDevice.shared.press(.home)
        app.activate()

        XCTAssertTrue(app.staticTexts["Foreground refresh requested."].waitForExistence(timeout: 5))
    }

    func testPrivacyShieldCoversProtectedContentDuringLifecycleTransition() {
        let app = XCUIApplication()
        app.launchEnvironment["RF_UI_TEST_PRIVACY_SHIELD_DELAY_SECONDS"] = "1.5"
        app.launch()
        XCTAssertTrue(app.webViews.firstMatch.waitForExistence(timeout: 15))

        XCUIDevice.shared.press(.home)
        app.activate()

        let shield = app.descendants(matching: .any)["rf-privacy-shield"]
        XCTAssertTrue(shield.waitForExistence(timeout: 2))
        XCTAssertTrue(app.staticTexts["RF Tools is locked"].exists)
        XCTAssertTrue(shield.waitForNonExistence(timeout: 5))
    }

    func testFaceIDSuccessUncoversProtectedContent() {
        let app = launchScenario("biometric-success")
        XCTAssertTrue(app.staticTexts["RF Tools is locked"].waitForExistence(timeout: 5))
        app.buttons["Unlock RF Tools"].tap()
        XCTAssertTrue(app.staticTexts["Device authentication succeeded using Face ID."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Home"].exists)
    }

    func testFaceIDCancellationKeepsProtectedContentCovered() {
        let app = launchScenario("biometric-cancelled")
        app.buttons["Unlock RF Tools"].tap()
        XCTAssertTrue(app.staticTexts["Unlock was canceled. Protected content remains covered."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["RF Tools is locked"].exists)
    }

    func testNativeUnlockSurfaceHasReadableOrderAndTouchSizedControl() {
        let app = launchScenario("biometric-cancelled")
        let title = app.staticTexts["RF Tools is locked"]
        let explanation = app.staticTexts[
            "Use Face ID, Touch ID, or your device passcode to continue."
        ]
        let unlock = app.buttons["Unlock RF Tools"]

        XCTAssertTrue(title.exists)
        XCTAssertTrue(explanation.exists)
        XCTAssertTrue(unlock.exists)
        XCTAssertTrue(unlock.isHittable)
        XCTAssertGreaterThanOrEqual(unlock.frame.width, 44)
        XCTAssertGreaterThanOrEqual(unlock.frame.height, 44)
        XCTAssertLessThan(title.frame.midY, explanation.frame.midY)
        XCTAssertLessThan(explanation.frame.midY, unlock.frame.midY)

        unlock.tap()
        XCTAssertTrue(app.staticTexts[
            "Unlock was canceled. Protected content remains covered."
        ].waitForExistence(timeout: 5))
    }

    func testUnavailableBiometricsShowsSetupRecovery() {
        let app = launchScenario("biometric-unavailable")
        app.buttons["Unlock RF Tools"].tap()
        XCTAssertTrue(app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "Device authentication is unavailable")
        ).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["RF Tools is locked"].exists)
    }

    func testBiometricFallbackUsesDevicePasscode() {
        let app = launchScenario("biometric-fallback")
        app.buttons["Unlock RF Tools"].tap()
        let fallback = app.buttons["Use Device Passcode"]
        XCTAssertTrue(fallback.waitForExistence(timeout: 5))
        fallback.tap()
        XCTAssertTrue(app.staticTexts["Device authentication succeeded using device passcode."].waitForExistence(timeout: 5))
    }

    func testAllowedLocationShowsProgressAndOnlyServerConfirmedSuccess() {
        let app = launchScenario("location-allowed")
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts["Finding an accurate location"].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts["Clock-in confirmed by RF Tools."].waitForExistence(timeout: 5))
        XCTAssertTrue(app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "confirmed by the server")
        ).firstMatch.exists)
    }

    func testDeniedLocationShowsSettingsRecoveryWithoutSuccess() {
        assertLocationFailure(
            scenario: "location-denied",
            messageFragment: "Location access is off",
            recoveryButton: "Open iPhone Settings"
        )
    }

    func testRestrictedLocationShowsManagerRecoveryWithoutSuccess() {
        assertLocationFailure(
            scenario: "location-restricted",
            messageFragment: "Location access is restricted",
            recoveryButton: "Ask your manager"
        )
    }

    func testInaccurateLocationShowsAccuracyRecoveryWithoutSuccess() {
        assertLocationFailure(
            scenario: "location-inaccurate",
            messageFragment: "accurate to about 250 m",
            recoveryButton: "Try location again"
        )
    }

    func testTimedOutLocationShowsRetryRecoveryWithoutSuccess() {
        assertLocationFailure(
            scenario: "location-timeout",
            messageFragment: "location took too long",
            recoveryButton: "Try location again"
        )
    }

    func testUnavailableLocationShowsServicesRecoveryWithoutSuccess() {
        assertLocationFailure(
            scenario: "location-unavailable",
            messageFragment: "could not get your location",
            recoveryButton: "Check Location Services"
        )
    }

    func testExpiredSessionRequiresSecureSignInAndKeepsWorkHidden() {
        let app = launchScenario("session-expired")
        XCTAssertTrue(app.staticTexts["Session expired"].waitForExistence(timeout: 5))
        app.buttons["Sign in again"].tap()
        XCTAssertTrue(app.staticTexts["Opening secure sign-in. Protected work remains hidden."].waitForExistence(timeout: 5))
    }

    func testTrustedLinksStayInAppAndExternalLinksLeaveTheWebView() {
        let app = launchScenario("navigation")
        app.buttons["Open trusted Clock link"].tap()
        XCTAssertTrue(app.staticTexts["Trusted Clock link stayed in RF Tools."].waitForExistence(timeout: 5))
        app.buttons["Open external link"].tap()
        XCTAssertTrue(app.staticTexts["External link opened outside the RF Tools WebView."].waitForExistence(timeout: 5))
    }

    func testUnavailableServiceShowsBundledRecoveryAndRetry() {
        let app = XCUIApplication()
        app.launchEnvironment["RF_UI_TEST_SERVER_URL"] = "http://127.0.0.1:9"
        app.launchEnvironment["RF_UI_TEST_LOAD_FALLBACK_SECONDS"] = "1"
        app.launchEnvironment["RF_UI_TEST_SERVICE_STATE"] = "operational"
        app.launch()

        let unavailableTitle = app.staticTexts["RF Tools is unavailable"]
        XCTAssertTrue(unavailableTitle.waitForExistence(timeout: 15))
        let unsentMessage = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "Your work has not been submitted")
        ).firstMatch
        XCTAssertTrue(unsentMessage.exists)
        XCTAssertTrue(app.links["Contact support"].exists)

        let retry = app.buttons["Try again"]
        XCTAssertTrue(retry.exists)
        retry.tap()
        XCTAssertTrue(unavailableTitle.waitForExistence(timeout: 15))
    }

    func testOfflineColdLaunchShowsBundledRecoveryAndRetry() {
        let app = XCUIApplication()
        app.launchEnvironment["RF_UI_TEST_SERVER_URL"] = "http://127.0.0.1:9"
        app.launchEnvironment["RF_UI_TEST_LOAD_FALLBACK_SECONDS"] = "1"
        app.launchEnvironment["RF_UI_TEST_SERVICE_STATE"] = "offline"
        app.launch()

        let offlineTitle = app.staticTexts["You're offline"]
        XCTAssertTrue(offlineTitle.waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["No connection"].exists)
        let unsentMessage = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "Your work has not been submitted")
        ).firstMatch
        XCTAssertTrue(unsentMessage.exists)
        XCTAssertTrue(app.links["Contact support"].exists)

        let retry = app.buttons["Try again"]
        XCTAssertTrue(retry.exists)
        retry.tap()
        XCTAssertTrue(offlineTitle.waitForExistence(timeout: 15))
    }

    func testBundledRecoveryDistinguishesPlannedMaintenance() {
        let app = XCUIApplication()
        app.launchEnvironment["RF_UI_TEST_SERVER_URL"] = "http://127.0.0.1:9"
        app.launchEnvironment["RF_UI_TEST_LOAD_FALLBACK_SECONDS"] = "1"
        app.launchEnvironment["RF_UI_TEST_SERVICE_STATE"] = "maintenance"
        app.launch()

        let maintenanceTitle = app.staticTexts["Maintenance in progress"]
        XCTAssertTrue(maintenanceTitle.waitForExistence(timeout: 15))
        XCTAssertTrue(app.staticTexts["Internet available · planned maintenance"].exists)
        let unsentMessage = app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS %@", "Your work has not been submitted")
        ).firstMatch
        XCTAssertTrue(unsentMessage.exists)
        XCTAssertTrue(app.buttons["Try again"].exists)
        XCTAssertTrue(app.links["Contact support"].exists)
    }

    private func launchScenario(_ scenario: String) -> XCUIApplication {
        let app = XCUIApplication()
        app.launchEnvironment["RF_UI_TEST_SCENARIO"] = scenario
        app.launch()
        XCTAssertTrue(app.otherElements["rf-ui-test-scenario"].waitForExistence(timeout: 5))
        return app
    }

    private func assertLocationFailure(
        scenario: String,
        messageFragment: String,
        recoveryButton: String
    ) {
        let app = launchScenario(scenario)
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.staticTexts.matching(
            NSPredicate(format: "label CONTAINS[c] %@", messageFragment)
        ).firstMatch.waitForExistence(timeout: 5))
        XCTAssertTrue(app.buttons[recoveryButton].exists)
        XCTAssertFalse(app.staticTexts["Clock-in confirmed by RF Tools."].exists)
    }
}

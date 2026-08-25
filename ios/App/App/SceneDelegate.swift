import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private let privacyShield = RFPrivacyShieldController()
    private var privacyShieldFallback: DispatchWorkItem?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let bridgeViewController = window?.rootViewController as? RFBridgeViewController else {
            RFMetricDiagnostics.shared.recordLifecycleError(.missingBridgeRoot)
            return
        }
        bridgeViewController.prepareForLaunch()
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        privacyShieldFallback?.cancel()
        #if DEBUG
        // Deterministic native scenario surfaces contain no employee data and
        // have their own explicit lock states. Do not let lifecycle churn from
        // the XCUITest runner place an invisible shield over their controls.
        if ProcessInfo.processInfo.environment["RF_UI_TEST_SCENARIO"] != nil {
            privacyShield.hide()
            return
        }
        #endif
        privacyShield.show(in: window)
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyShieldFallback?.cancel()
        #if DEBUG
        (window?.rootViewController as? RFBridgeViewController)?.sceneDidBecomeActiveForUITest()
        if ProcessInfo.processInfo.environment["RF_UI_TEST_SCENARIO"] != nil {
            privacyShield.hide()
            return
        }
        #endif
        #if DEBUG
        if let rawDelay = ProcessInfo.processInfo.environment["RF_UI_TEST_PRIVACY_SHIELD_DELAY_SECONDS"],
           let delay = TimeInterval(rawDelay),
           delay > 0 {
            schedulePrivacyShieldFallback(after: delay)
            return
        }
        #endif
        // Keep the native cover in place until the WebView confirms that it
        // has rendered either the protected-session gate or another safe
        // blocking surface. A timer here could expose stale employee content
        // when JavaScript or the remote page fails during foreground resume.
        // The bundled load-error page performs the same explicit handshake.
    }

    func webContentIsReadyForPrivacyShieldRemoval() {
        #if DEBUG
        if ProcessInfo.processInfo.environment["RF_UI_TEST_PRIVACY_SHIELD_DELAY_SECONDS"] != nil {
            return
        }
        #endif
        privacyShieldFallback?.cancel()
        privacyShield.hide()
    }

    private func schedulePrivacyShieldFallback(after delay: TimeInterval) {
        let item = DispatchWorkItem { [weak self] in
            self?.privacyShield.hide()
        }
        privacyShieldFallback = item
        DispatchQueue.main.asyncAfter(deadline: .now() + delay, execute: item)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

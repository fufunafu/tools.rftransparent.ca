import Capacitor
import UIKit

final class RFBridgeViewController: CAPBridgeViewController {
    private var loadFailureFallback: DispatchWorkItem?
    private var failedRemoteURL: URL?
    #if DEBUG
    private var uiTestScenarioPresenter: RFUITestScenarioPresenter?
    #endif

    override func instanceDescriptor() -> InstanceDescriptor {
        let descriptor = super.instanceDescriptor()
        #if DEBUG
        if let scenario = ProcessInfo.processInfo.environment["RF_UI_TEST_SCENARIO"],
           !scenario.isEmpty {
            // Scenario tests exercise the native surface only. Load the tiny
            // bundled index behind it instead of starting a remote WebKit
            // navigation for every XCUITest launch. This keeps repeated CI
            // launches deterministic and avoids exhausting WebKit runners.
            descriptor.serverURL = nil
            var pluginConfigurations = descriptor.pluginConfigurations as? [String: Any] ?? [:]
            var splashConfiguration = pluginConfigurations["SplashScreen"] as? [String: Any] ?? [:]
            splashConfiguration["launchShowDuration"] = 0
            pluginConfigurations["SplashScreen"] = splashConfiguration
            descriptor.pluginConfigurations = pluginConfigurations
        } else if let testServerURL = ProcessInfo.processInfo.environment["RF_UI_TEST_SERVER_URL"],
           URL(string: testServerURL) != nil {
            descriptor.serverURL = testServerURL
        }
        #endif
        return descriptor
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(RFNavigationGuardPlugin())
        bridge?.registerPluginInstance(RFNativeSupportPlugin())
    }

    func prepareForLaunch() {
        view.backgroundColor = RFAppAppearance.brandBackground
        view.accessibilityIdentifier = "rf-native-root"
        view.accessibilityLabel = "RF Tools branded loading view"
        #if DEBUG
        if let presenter = RFUITestScenarioPresenter.installIfRequested(in: view) {
            uiTestScenarioPresenter = presenter
            return
        }
        #endif
        scheduleLoadFailureFallback()
    }

    #if DEBUG
    func sceneDidBecomeActiveForUITest() {
        uiTestScenarioPresenter?.sceneDidBecomeActive()
    }
    #endif

    private func scheduleLoadFailureFallback() {
        loadFailureFallback?.cancel()
        let item = DispatchWorkItem { [weak self] in
            guard let self, let webView = self.webView else { return }
            webView.evaluateJavaScript(
                "document.documentElement && document.documentElement.dataset.rfAppReady === 'true'"
            ) { result, error in
                guard error != nil || (result as? Bool) != true else { return }
                guard let errorURL = self.bridge?.config.errorPathURL else {
                    RFMetricDiagnostics.shared.recordLifecycleError(.missingLoadFailurePage)
                    return
                }
                if let currentURL = webView.url,
                   let scheme = currentURL.scheme?.lowercased(),
                   scheme == "http" || scheme == "https" {
                    self.failedRemoteURL = currentURL
                }
                webView.load(URLRequest(url: errorURL))
            }
        }
        loadFailureFallback = item

        #if DEBUG
        let testDelay = ProcessInfo.processInfo.environment["RF_UI_TEST_LOAD_FALLBACK_SECONDS"]
            .flatMap(TimeInterval.init)
        #else
        let testDelay: TimeInterval? = nil
        #endif
        DispatchQueue.main.asyncAfter(deadline: .now() + (testDelay ?? 10), execute: item)
    }

    func retryRemoteLoad(completion: @escaping (Bool) -> Void) {
        DispatchQueue.main.async { [weak self] in
            guard let self, let webView = self.webView else {
                completion(false)
                return
            }

            #if DEBUG
            let testServerURL = ProcessInfo.processInfo.environment["RF_UI_TEST_SERVER_URL"]
                .flatMap(URL.init(string:))
            #else
            let testServerURL: URL? = nil
            #endif
            guard let target = self.failedRemoteURL
                ?? testServerURL
                ?? self.bridge?.config.serverURL
                ?? URL(string: "https://tools.rftransparent.ca") else {
                completion(false)
                return
            }

            // The bundled recovery document is marked ready so the privacy
            // shield can be removed. Clear that marker before retrying, then
            // arm a fresh fallback. Otherwise a failed provisional navigation
            // can leave the old ready document visible long enough for the
            // fallback check to exit early.
            webView.evaluateJavaScript(
                "document.documentElement && delete document.documentElement.dataset.rfAppReady"
            ) { [weak self, weak webView] _, _ in
                guard let self, let webView else {
                    completion(false)
                    return
                }
                self.scheduleLoadFailureFallback()
                var request = URLRequest(url: target)
                request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
                webView.load(request)
                completion(true)
            }
        }
    }
}

import Capacitor
import UIKit
import WebKit

@objc(RFNavigationGuardPlugin)
final class RFNavigationGuardPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "RFNavigationGuardPlugin"
    let jsName = "RFNavigationGuard"
    let pluginMethods: [CAPPluginMethod] = []

    private let policy = RFNavigationPolicy()

    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return true }

        let decision = policy.decision(
            for: url,
            localOrigin: bridge?.config.localURL,
            configuredOrigin: bridge?.config.serverURL
        )
        if decision == .allowInApp { return false }
        if decision == .unsupported { return true }

        if let scheme = url.scheme?.lowercased(), ["mailto", "tel", "sms"].contains(scheme) {
            UIApplication.shared.open(url, options: [:])
            return true
        }

        if navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true {
            UIApplication.shared.open(url, options: [:])
        }
        return true
    }
}

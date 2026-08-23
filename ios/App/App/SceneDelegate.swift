import UIKit
import Capacitor
import WebKit

@objc(RFNavigationGuardPlugin)
final class RFNavigationGuardPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "RFNavigationGuardPlugin"
    let jsName = "RFNavigationGuard"
    let pluginMethods: [CAPPluginMethod] = []

    private let productionOrigin = URL(string: "https://tools.rftransparent.ca")!

    private func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        if url.scheme?.lowercased() == "https" { return 443 }
        if url.scheme?.lowercased() == "http" { return 80 }
        return nil
    }

    private func hasSameOrigin(_ first: URL, _ second: URL) -> Bool {
        return first.scheme?.lowercased() == second.scheme?.lowercased()
            && first.host?.lowercased() == second.host?.lowercased()
            && effectivePort(first) == effectivePort(second)
    }

    private func isLocalDevelopmentOrigin(_ url: URL) -> Bool {
        return url.scheme?.lowercased() == "http"
            && (url.host?.lowercased() == "localhost" || url.host == "127.0.0.1")
    }

    override func shouldOverrideLoad(_ navigationAction: WKNavigationAction) -> NSNumber? {
        guard let url = navigationAction.request.url else { return true }

        if hasSameOrigin(url, productionOrigin) {
            return false
        }

        if let localOrigin = bridge?.config.localURL, hasSameOrigin(url, localOrigin) {
            return false
        }

        if let configuredOrigin = bridge?.config.serverURL,
           isLocalDevelopmentOrigin(configuredOrigin),
           hasSameOrigin(url, configuredOrigin) {
            return false
        }

        if let scheme = url.scheme?.lowercased(), ["mailto", "tel", "sms"].contains(scheme) {
            UIApplication.shared.open(url, options: [:])
            return true
        }

        guard url.scheme == "http" || url.scheme == "https" else {
            return nil
        }

        if navigationAction.targetFrame == nil || navigationAction.targetFrame?.isMainFrame == true {
            UIApplication.shared.open(url, options: [:])
        }
        return true
    }
}

final class RFBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(RFNavigationGuardPlugin())
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?
    private var privacyView: UIView?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let bridgeViewController = window?.rootViewController as? RFBridgeViewController else { return }
        bridgeViewController.view.backgroundColor = UIColor(red: 30 / 255, green: 58 / 255, blue: 138 / 255, alpha: 1)
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func sceneWillResignActive(_ scene: UIScene) {
        guard let window, privacyView == nil else { return }

        let cover = UIView(frame: window.bounds)
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.backgroundColor = UIColor(red: 30 / 255, green: 58 / 255, blue: 138 / 255, alpha: 1)

        let mark = UILabel()
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.text = "RF"
        mark.textAlignment = .center
        mark.font = .systemFont(ofSize: 22, weight: .bold)
        mark.textColor = .white
        mark.backgroundColor = UIColor(red: 37 / 255, green: 99 / 255, blue: 235 / 255, alpha: 1)
        mark.layer.cornerRadius = 18
        mark.clipsToBounds = true
        cover.addSubview(mark)

        NSLayoutConstraint.activate([
            mark.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
            mark.widthAnchor.constraint(equalToConstant: 64),
            mark.heightAnchor.constraint(equalToConstant: 64)
        ])

        window.addSubview(cover)
        privacyView = cover
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
        privacyView?.removeFromSuperview()
        privacyView = nil
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

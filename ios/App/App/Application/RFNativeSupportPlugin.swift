import Capacitor
import CoreLocation
import UIKit

@objc(RFNativeSupportPlugin)
final class RFNativeSupportPlugin: CAPPlugin, CAPBridgedPlugin {
    let identifier = "RFNativeSupportPlugin"
    let jsName = "RFNativeSupport"
    let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getDeviceInfo", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getServiceStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getLocationAuthorizationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "recordWebViewLoadFailure", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "hidePrivacyShield", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "retryRemoteLoad", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise)
    ]

    @objc func getDeviceInfo(_ call: CAPPluginCall) {
        let device = UIDevice.current
        let diagnostics = RFMetricDiagnostics.shared.snapshot()
        #if DEBUG
        let pushEnvironment = "sandbox"
        #else
        let pushEnvironment = "production"
        #endif
        call.resolve([
            "operatingSystem": "\(device.systemName) \(device.systemVersion)",
            "deviceModel": device.model,
            "locale": Locale.current.identifier,
            "pushEnvironment": pushEnvironment,
            "nativeCrashCount": diagnostics.crashCount,
            "lastNativeCrashAt": diagnostics.lastCrashAt ?? NSNull(),
            "lastNativeCrashSignature": diagnostics.lastCrashSignature ?? NSNull(),
            "webViewLoadFailureCount": diagnostics.webViewLoadFailureCount,
            "lastWebViewLoadFailureAt": diagnostics.lastWebViewLoadFailureAt ?? NSNull(),
            "lastLifecycleError": diagnostics.lastLifecycleError ?? NSNull()
        ])
    }

    @objc func recordWebViewLoadFailure(_ call: CAPPluginCall) {
        RFMetricDiagnostics.shared.recordWebViewLoadFailure()
        call.resolve()
    }

    @objc func getLocationAuthorizationStatus(_ call: CAPPluginCall) {
        guard CLLocationManager.locationServicesEnabled() else {
            call.resolve(["status": "unavailable"])
            return
        }

        let status: String
        switch CLLocationManager().authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            status = "granted"
        case .denied:
            status = "denied"
        case .restricted:
            status = "restricted"
        case .notDetermined:
            status = "prompt"
        @unknown default:
            status = "unavailable"
        }
        call.resolve(["status": status])
    }

    @objc func hidePrivacyShield(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            let sceneDelegate = UIApplication.shared.connectedScenes
                .compactMap { $0.delegate as? SceneDelegate }
                .first
            guard let sceneDelegate else {
                call.reject("The native privacy shield is unavailable.")
                return
            }
            sceneDelegate.webContentIsReadyForPrivacyShieldRemoval()
            call.resolve()
        }
    }

    @objc func retryRemoteLoad(_ call: CAPPluginCall) {
        guard let bridgeViewController = bridge?.viewController as? RFBridgeViewController else {
            call.reject("The RF Tools recovery controller is unavailable.")
            return
        }
        bridgeViewController.retryRemoteLoad { started in
            if started {
                call.resolve()
            } else {
                call.reject("RF Tools could not retry the remote service.")
            }
        }
    }

    @objc func getServiceStatus(_ call: CAPPluginCall) {
        #if DEBUG
        if let testState = ProcessInfo.processInfo.environment["RF_UI_TEST_SERVICE_STATE"] {
            call.resolve([
                "state": testState,
                "message": NSNull()
            ])
            return
        }
        #endif

        guard let url = URL(string: "https://tools.rftransparent.ca/api/native/status") else {
            call.reject("The RF Tools service status URL is unavailable.")
            return
        }
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 8
        URLSession.shared.dataTask(with: request) { data, response, error in
            guard error == nil,
                  let http = response as? HTTPURLResponse,
                  http.statusCode == 200,
                  let data,
                  let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let state = payload["state"] as? String,
                  state == "operational" || state == "maintenance" else {
                call.reject("RF Tools could not check the service status.")
                return
            }
            call.resolve([
                "state": state,
                "message": payload["message"] as? String ?? NSNull()
            ])
        }.resume()
    }

    @objc func openSettings(_ call: CAPPluginCall) {
        guard let url = URL(string: UIApplication.openSettingsURLString) else {
            call.reject("System Settings are unavailable.")
            return
        }
        DispatchQueue.main.async {
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("RF Tools could not open System Settings.")
                }
            }
        }
    }
}

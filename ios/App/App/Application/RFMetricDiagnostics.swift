import Foundation
import MetricKit
import OSLog

enum RFNativeLifecycleError: String {
    case missingBridgeRoot = "missing_bridge_root"
    case missingLoadFailurePage = "missing_load_failure_page"
}

struct RFNativeDiagnosticSnapshot {
    let crashCount: Int
    let lastCrashAt: String?
    let lastCrashSignature: String?
    let webViewLoadFailureCount: Int
    let lastWebViewLoadFailureAt: String?
    let lastLifecycleError: String?
}

final class RFMetricDiagnostics: NSObject, MXMetricManagerSubscriber {
    static let shared = RFMetricDiagnostics()

    private let defaults = UserDefaults.standard
    private let logger = Logger(subsystem: "ca.rftransparent.tools", category: "diagnostics")
    private let crashCountKey = "rf.native.crashCount"
    private let lastCrashAtKey = "rf.native.lastCrashAt"
    private let lastCrashSignatureKey = "rf.native.lastCrashSignature"
    private let webViewLoadFailureCountKey = "rf.native.webViewLoadFailureCount"
    private let lastWebViewLoadFailureAtKey = "rf.native.lastWebViewLoadFailureAt"
    private let lastLifecycleErrorKey = "rf.native.lastLifecycleError"
    private var started = false

    func start() {
        guard !started else { return }
        started = true
        MXMetricManager.shared.add(self)
    }

    func recordLifecycleError(_ error: RFNativeLifecycleError) {
        defaults.set(error.rawValue, forKey: lastLifecycleErrorKey)
        logger.error("Native lifecycle error: \(error.rawValue, privacy: .public)")
    }

    func recordWebViewLoadFailure() {
        defaults.set(
            defaults.integer(forKey: webViewLoadFailureCountKey) + 1,
            forKey: webViewLoadFailureCountKey
        )
        defaults.set(
            ISO8601DateFormatter().string(from: Date()),
            forKey: lastWebViewLoadFailureAtKey
        )
        logger.error("Remote WebView load failed")
    }

    func snapshot() -> RFNativeDiagnosticSnapshot {
        RFNativeDiagnosticSnapshot(
            crashCount: defaults.integer(forKey: crashCountKey),
            lastCrashAt: defaults.string(forKey: lastCrashAtKey),
            lastCrashSignature: defaults.string(forKey: lastCrashSignatureKey),
            webViewLoadFailureCount: defaults.integer(forKey: webViewLoadFailureCountKey),
            lastWebViewLoadFailureAt: defaults.string(forKey: lastWebViewLoadFailureAtKey),
            lastLifecycleError: defaults.string(forKey: lastLifecycleErrorKey)
        )
    }

    func didReceive(_ payloads: [MXMetricPayload]) {
        logger.info("Received \(payloads.count, privacy: .public) MetricKit metric payloads")
    }

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        let crashDiagnostics = payloads.flatMap { $0.crashDiagnostics ?? [] }
        let crashes = crashDiagnostics.count
        guard crashes > 0 else { return }

        defaults.set(defaults.integer(forKey: crashCountKey) + crashes, forKey: crashCountKey)
        defaults.set(ISO8601DateFormatter().string(from: Date()), forKey: lastCrashAtKey)
        if let latest = crashDiagnostics.last,
           let signature = Self.crashSignature(
               exceptionType: latest.exceptionType,
               exceptionCode: latest.exceptionCode,
               signal: latest.signal
           ) {
            defaults.set(signature, forKey: lastCrashSignatureKey)
        }
        logger.error("Received \(crashes, privacy: .public) native crash diagnostics")
    }

    static func crashSignature(
        exceptionType: NSNumber?,
        exceptionCode: NSNumber?,
        signal: NSNumber?
    ) -> String? {
        let values = [
            exceptionType.map { "exception=\($0.stringValue)" },
            exceptionCode.map { "code=\($0.stringValue)" },
            signal.map { "signal=\($0.stringValue)" }
        ].compactMap { $0 }
        return values.isEmpty ? nil : values.joined(separator: " ")
    }
}

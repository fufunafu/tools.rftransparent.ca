import Foundation

enum RFNavigationDecision: Equatable {
    case allowInApp
    case openExternally
    case unsupported
}

struct RFNavigationPolicy {
    static let productionOrigin = URL(string: "https://tools.rftransparent.ca")!

    func decision(
        for url: URL,
        localOrigin: URL?,
        configuredOrigin: URL?
    ) -> RFNavigationDecision {
        if hasSameOrigin(url, Self.productionOrigin) { return .allowInApp }
        if let localOrigin, hasSameOrigin(url, localOrigin) { return .allowInApp }
        if let configuredOrigin,
           isLocalDevelopmentOrigin(configuredOrigin),
           hasSameOrigin(url, configuredOrigin) {
            return .allowInApp
        }
        if let scheme = url.scheme?.lowercased(), ["mailto", "tel", "sms"].contains(scheme) {
            return .openExternally
        }
        if url.scheme?.lowercased() == "http" || url.scheme?.lowercased() == "https" {
            return .openExternally
        }
        return .unsupported
    }

    private func effectivePort(_ url: URL) -> Int? {
        if let port = url.port { return port }
        if url.scheme?.lowercased() == "https" { return 443 }
        if url.scheme?.lowercased() == "http" { return 80 }
        return nil
    }

    private func hasSameOrigin(_ first: URL, _ second: URL) -> Bool {
        first.scheme?.lowercased() == second.scheme?.lowercased()
            && first.host?.lowercased() == second.host?.lowercased()
            && effectivePort(first) == effectivePort(second)
    }

    private func isLocalDevelopmentOrigin(_ url: URL) -> Bool {
        url.scheme?.lowercased() == "http"
            && (url.host?.lowercased() == "localhost" || url.host == "127.0.0.1")
    }
}

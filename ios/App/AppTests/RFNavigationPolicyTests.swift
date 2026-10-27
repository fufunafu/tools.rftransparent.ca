import XCTest
@testable import App

final class RFNavigationPolicyTests: XCTestCase {
    private let policy = RFNavigationPolicy()

    func testProductionOriginStaysInsideApp() throws {
        let url = try XCTUnwrap(URL(string: "https://tools.rftransparent.ca/clock"))
        XCTAssertEqual(policy.decision(for: url, localOrigin: nil, configuredOrigin: nil), .allowInApp)
    }

    func testLookalikeAndCleartextOriginsLeaveApp() throws {
        for value in [
            "https://tools.rftransparent.ca.evil.example/clock",
            "http://tools.rftransparent.ca/clock",
            "https://evil.example/clock"
        ] {
            let url = try XCTUnwrap(URL(string: value))
            XCTAssertEqual(policy.decision(for: url, localOrigin: nil, configuredOrigin: nil), .openExternally)
        }
    }

    func testExactLocalDevelopmentOriginStaysInsideApp() throws {
        let configured = try XCTUnwrap(URL(string: "http://127.0.0.1:3000"))
        let url = try XCTUnwrap(URL(string: "http://127.0.0.1:3000/todos"))
        XCTAssertEqual(
            policy.decision(for: url, localOrigin: configured, configuredOrigin: configured),
            .allowInApp
        )
    }

    func testPhoneAndMailLinksLeaveApp() throws {
        for value in ["tel:+14165550100", "mailto:support@example.com", "sms:+14165550100"] {
            let url = try XCTUnwrap(URL(string: value))
            XCTAssertEqual(policy.decision(for: url, localOrigin: nil, configuredOrigin: nil), .openExternally)
        }
    }

    func testUnknownSchemesAreUnsupported() throws {
        let url = try XCTUnwrap(URL(string: "untrusted-app://sensitive-action"))
        XCTAssertEqual(
            policy.decision(for: url, localOrigin: nil, configuredOrigin: nil),
            .unsupported
        )
    }
}

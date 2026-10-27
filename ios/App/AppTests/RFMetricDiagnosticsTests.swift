import XCTest
@testable import App

final class RFMetricDiagnosticsTests: XCTestCase {
    func testCrashSignatureContainsOnlyTechnicalNumericFields() {
        XCTAssertEqual(
            RFMetricDiagnostics.crashSignature(
                exceptionType: 1,
                exceptionCode: 2,
                signal: 6
            ),
            "exception=1 code=2 signal=6"
        )
        XCTAssertNil(
            RFMetricDiagnostics.crashSignature(
                exceptionType: nil,
                exceptionCode: nil,
                signal: nil
            )
        )
    }

    func testWebViewLoadFailureIsPersistedForSupportDiagnostics() {
        let diagnostics = RFMetricDiagnostics.shared
        let before = diagnostics.snapshot()

        diagnostics.recordWebViewLoadFailure()

        let after = diagnostics.snapshot()
        XCTAssertEqual(after.webViewLoadFailureCount, before.webViewLoadFailureCount + 1)
        XCTAssertNotNil(after.lastWebViewLoadFailureAt)
    }
}

import XCTest
import UIKit
@testable import App

final class RFPrivacyShieldControllerTests: XCTestCase {
    func testShieldCoversAndUncoversTheWindow() {
        let window = UIWindow(frame: CGRect(x: 0, y: 0, width: 390, height: 844))
        let shield = RFPrivacyShieldController()
        shield.show(in: window)
        XCTAssertNotNil(window.subviews.first { $0.accessibilityIdentifier == "rf-privacy-shield" })
        shield.hide()
        XCTAssertNil(window.subviews.first { $0.accessibilityIdentifier == "rf-privacy-shield" })
    }
}

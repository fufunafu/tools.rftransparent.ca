import XCTest
import UserNotifications
@testable import App

final class RFNotificationCategoriesTests: XCTestCase {
    func testOperationalCategoriesAreRegistered() {
        RFNotificationCategories.configure()
        let expectation = expectation(description: "notification categories")
        UNUserNotificationCenter.current().getNotificationCategories { categories in
            let identifiers = Set(categories.map(\.identifier))
            XCTAssertTrue(identifiers.isSuperset(of: ["RF_TASK", "RF_OVERDUE", "RF_CLOCK", "RF_FOLLOW_UP", "RF_CALLBACK"]))
            for category in categories where identifiers.contains(category.identifier) {
                XCTAssertFalse(category.options.contains(.customDismissAction))
            }
            expectation.fulfill()
        }
        wait(for: [expectation], timeout: 2)
    }
}

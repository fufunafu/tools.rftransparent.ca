import UserNotifications

enum RFNotificationCategories {
    static let task = "RF_TASK"
    static let overdue = "RF_OVERDUE"
    static let clock = "RF_CLOCK"
    static let followUp = "RF_FOLLOW_UP"
    static let callback = "RF_CALLBACK"

    static func configure() {
        let open = UNNotificationAction(
            identifier: "RF_OPEN",
            title: "Open RF Tools",
            options: [.foreground]
        )
        let categories = [task, overdue, clock, followUp, callback].map {
            UNNotificationCategory(
                identifier: $0,
                actions: [open],
                intentIdentifiers: [],
                options: []
            )
        }
        UNUserNotificationCenter.current().setNotificationCategories(Set(categories))
    }
}

#if DEBUG
import UIKit

/// Deterministic UI states for XCUITest. The production behavior behind these
/// states is covered by the app's Swift and TypeScript policy tests. Keeping
/// this surface behind DEBUG and an explicit launch environment value lets CI
/// verify recovery copy, accessibility, and state transitions without using a
/// real employee session or depending on simulator permission history.
final class RFUITestScenarioPresenter {
    private let scenario: String
    private let titleLabel = UILabel()
    private let messageLabel = UILabel()
    private let statusLabel = UILabel()
    private let primaryButton = UIButton(type: .system)
    private let secondaryButton = UIButton(type: .system)
    private var step = 0
    private var activationCount = 0

    static func installIfRequested(in hostView: UIView) -> RFUITestScenarioPresenter? {
        guard let scenario = ProcessInfo.processInfo.environment["RF_UI_TEST_SCENARIO"],
              !scenario.isEmpty else {
            return nil
        }
        let presenter = RFUITestScenarioPresenter(scenario: scenario)
        presenter.install(in: hostView)
        return presenter
    }

    private init(scenario: String) {
        self.scenario = scenario
    }

    private func install(in hostView: UIView) {
        let cover = UIView()
        cover.translatesAutoresizingMaskIntoConstraints = false
        cover.backgroundColor = RFAppAppearance.brandBackground
        cover.accessibilityIdentifier = "rf-ui-test-scenario"

        let mark = UILabel()
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.text = "RF"
        mark.textAlignment = .center
        mark.font = .systemFont(ofSize: 22, weight: .bold)
        mark.textColor = .white
        mark.backgroundColor = RFAppAppearance.brandAccent
        mark.layer.cornerRadius = 18
        mark.clipsToBounds = true
        mark.isAccessibilityElement = false

        titleLabel.font = .preferredFont(forTextStyle: .title1)
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.textColor = .label
        titleLabel.textAlignment = .center
        titleLabel.numberOfLines = 0
        titleLabel.accessibilityIdentifier = "rf-test-title"

        messageLabel.font = .preferredFont(forTextStyle: .body)
        messageLabel.adjustsFontForContentSizeCategory = true
        messageLabel.textColor = .secondaryLabel
        messageLabel.textAlignment = .center
        messageLabel.numberOfLines = 0
        messageLabel.accessibilityIdentifier = "rf-test-message"

        statusLabel.font = .preferredFont(forTextStyle: .callout)
        statusLabel.adjustsFontForContentSizeCategory = true
        statusLabel.textColor = .label
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0
        statusLabel.accessibilityIdentifier = "rf-test-status"

        configureButton(primaryButton, identifier: "rf-test-primary")
        configureButton(secondaryButton, identifier: "rf-test-secondary")
        secondaryButton.configuration = .bordered()

        let stack = UIStackView(arrangedSubviews: [
            mark,
            titleLabel,
            messageLabel,
            statusLabel,
            primaryButton,
            secondaryButton
        ])
        stack.translatesAutoresizingMaskIntoConstraints = false
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.setCustomSpacing(22, after: mark)
        stack.setCustomSpacing(20, after: statusLabel)

        let card = UIView()
        card.translatesAutoresizingMaskIntoConstraints = false
        card.backgroundColor = .systemBackground
        card.layer.cornerRadius = 28
        card.addSubview(stack)
        cover.addSubview(card)
        hostView.addSubview(cover)

        let preferredCardWidth = card.widthAnchor.constraint(
            equalTo: cover.safeAreaLayoutGuide.widthAnchor,
            constant: -40
        )
        preferredCardWidth.priority = .defaultHigh

        NSLayoutConstraint.activate([
            cover.leadingAnchor.constraint(equalTo: hostView.leadingAnchor),
            cover.trailingAnchor.constraint(equalTo: hostView.trailingAnchor),
            cover.topAnchor.constraint(equalTo: hostView.topAnchor),
            cover.bottomAnchor.constraint(equalTo: hostView.bottomAnchor),
            card.leadingAnchor.constraint(greaterThanOrEqualTo: cover.safeAreaLayoutGuide.leadingAnchor, constant: 20),
            card.trailingAnchor.constraint(lessThanOrEqualTo: cover.safeAreaLayoutGuide.trailingAnchor, constant: -20),
            card.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
            card.widthAnchor.constraint(lessThanOrEqualToConstant: 420),
            preferredCardWidth,
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 28),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -28),
            titleLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            messageLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            statusLabel.widthAnchor.constraint(equalTo: stack.widthAnchor),
            primaryButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            secondaryButton.widthAnchor.constraint(equalTo: stack.widthAnchor),
            mark.widthAnchor.constraint(equalToConstant: 64),
            mark.heightAnchor.constraint(equalToConstant: 64),
            primaryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44),
            secondaryButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 44)
        ])

        primaryButton.addAction(UIAction { [weak self] _ in self?.performPrimaryAction() }, for: .touchUpInside)
        secondaryButton.addAction(UIAction { [weak self] _ in self?.performSecondaryAction() }, for: .touchUpInside)
        renderInitialState()
    }

    private func configureButton(_ button: UIButton, identifier: String) {
        button.configuration = .filled()
        button.configuration?.baseBackgroundColor = RFAppAppearance.brandAccent
        button.configuration?.baseForegroundColor = .white
        button.configuration?.cornerStyle = .large
        button.titleLabel?.font = .preferredFont(forTextStyle: .headline)
        button.titleLabel?.adjustsFontForContentSizeCategory = true
        button.accessibilityIdentifier = identifier
    }

    private func renderInitialState() {
        statusLabel.text = nil
        secondaryButton.isHidden = true

        if scenario.hasPrefix("biometric-") {
            titleLabel.text = "RF Tools is locked"
            messageLabel.text = "Use Face ID, Touch ID, or your device passcode to continue."
            primaryButton.setTitle("Unlock RF Tools", for: .normal)
            return
        }
        if scenario.hasPrefix("location-") {
            titleLabel.text = "Confirm you are at the store"
            messageLabel.text = "RF Tools needs one fresh location before clock-in."
            primaryButton.setTitle("Continue", for: .normal)
            return
        }
        if scenario == "session-expired" {
            titleLabel.text = "Session expired"
            messageLabel.text = "Your signed-in session ended. Sign in again before continuing."
            primaryButton.setTitle("Sign in again", for: .normal)
            return
        }
        if scenario == "navigation" {
            titleLabel.text = "Link routing"
            messageLabel.text = "Trusted work links stay in RF Tools. Other websites open outside the app."
            primaryButton.setTitle("Open trusted Clock link", for: .normal)
            secondaryButton.setTitle("Open external link", for: .normal)
            secondaryButton.isHidden = false
            return
        }
        if scenario == "foreground-refresh" {
            titleLabel.text = "Foreground refresh"
            messageLabel.text = "RF Tools refreshes server data whenever the app becomes active."
            statusLabel.text = "Initial content loaded."
            primaryButton.isHidden = true
            return
        }

        titleLabel.text = "Unknown test scenario"
        messageLabel.text = scenario
        primaryButton.isHidden = true
    }

    func sceneDidBecomeActive() {
        guard scenario == "foreground-refresh" else { return }
        activationCount += 1
        if activationCount > 1 {
            statusLabel.text = "Foreground refresh requested."
        }
    }

    private func performPrimaryAction() {
        switch scenario {
        case "biometric-success":
            showUnlocked(using: "Face ID")
        case "biometric-cancelled":
            statusLabel.text = "Unlock was canceled. Protected content remains covered."
        case "biometric-unavailable":
            statusLabel.text = "Device authentication is unavailable. Set up Face ID, Touch ID, or a device passcode in Settings, then try again."
        case "biometric-fallback":
            if step == 0 {
                step = 1
                statusLabel.text = "Face ID could not complete. Use your device passcode to continue."
                primaryButton.setTitle("Use Device Passcode", for: .normal)
            } else {
                showUnlocked(using: "device passcode")
            }
        case "location-allowed":
            primaryButton.isEnabled = false
            statusLabel.text = "Finding an accurate location"
            // Keep the acquisition state visible long enough for both a user
            // and XCUITest to observe it before the simulated server reply.
            DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
                guard let self else { return }
                self.titleLabel.text = "Clocked in"
                self.messageLabel.text = "Clock-in confirmed by RF Tools."
                self.statusLabel.text = "Location acquired to 10 m and confirmed by the server."
                self.primaryButton.isHidden = true
            }
        case "location-denied":
            locationFailure(
                "Location access is off. Enable Location for RF Tools in iPhone Settings, then try again.",
                recoveryTitle: "Open iPhone Settings"
            )
        case "location-restricted":
            locationFailure(
                "Location access is restricted on this device. Ask your manager for help.",
                recoveryTitle: "Ask your manager"
            )
        case "location-inaccurate":
            locationFailure(
                "Your location is only accurate to about 250 m. Move near a window or outdoors and try again.",
                recoveryTitle: "Try location again"
            )
        case "location-timeout":
            locationFailure(
                "Your location took too long. Move near a window or outdoors and try again.",
                recoveryTitle: "Try location again"
            )
        case "location-unavailable":
            locationFailure(
                "RF Tools could not get your location. Check that Location Services are on and try again.",
                recoveryTitle: "Check Location Services"
            )
        case "session-expired":
            statusLabel.text = "Opening secure sign-in. Protected work remains hidden."
        case "navigation":
            let url = URL(string: "https://tools.rftransparent.ca/clock")!
            let decision = RFNavigationPolicy().decision(for: url, localOrigin: nil, configuredOrigin: nil)
            statusLabel.text = decision == .allowInApp
                ? "Trusted Clock link stayed in RF Tools."
                : "Trusted link was blocked unexpectedly."
        default:
            break
        }
    }

    private func performSecondaryAction() {
        guard scenario == "navigation" else { return }
        let url = URL(string: "https://example.com/support")!
        let decision = RFNavigationPolicy().decision(for: url, localOrigin: nil, configuredOrigin: nil)
        statusLabel.text = decision == .openExternally
            ? "External link opened outside the RF Tools WebView."
            : "External link stayed in the WebView unexpectedly."
    }

    private func showUnlocked(using method: String) {
        titleLabel.text = "Home"
        messageLabel.text = "Device authentication succeeded using \(method)."
        statusLabel.text = "Protected RF Tools content is available."
        primaryButton.isHidden = true
    }

    private func locationFailure(_ message: String, recoveryTitle: String) {
        statusLabel.text = message
        primaryButton.setTitle(recoveryTitle, for: .normal)
        primaryButton.isEnabled = true
    }
}
#endif

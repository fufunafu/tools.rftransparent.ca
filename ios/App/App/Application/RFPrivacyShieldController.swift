import UIKit

final class RFPrivacyShieldController {
    private var coverView: UIView?

    func show(in window: UIWindow?) {
        guard let window, coverView == nil else { return }

        let cover = UIView(frame: window.bounds)
        cover.accessibilityIdentifier = "rf-privacy-shield"
        cover.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        cover.backgroundColor = RFAppAppearance.brandBackground

        let mark = UILabel()
        mark.translatesAutoresizingMaskIntoConstraints = false
        mark.text = "RF"
        mark.textAlignment = .center
        mark.font = .systemFont(ofSize: 22, weight: .bold)
        mark.textColor = .white
        mark.backgroundColor = RFAppAppearance.brandAccent
        mark.layer.cornerRadius = 18
        mark.clipsToBounds = true
        mark.isAccessibilityElement = true
        mark.accessibilityLabel = "RF Tools is locked"
        cover.addSubview(mark)

        NSLayoutConstraint.activate([
            mark.centerXAnchor.constraint(equalTo: cover.centerXAnchor),
            mark.centerYAnchor.constraint(equalTo: cover.centerYAnchor),
            mark.widthAnchor.constraint(equalToConstant: 64),
            mark.heightAnchor.constraint(equalToConstant: 64)
        ])

        window.addSubview(cover)
        coverView = cover
    }

    func hide() {
        coverView?.removeFromSuperview()
        coverView = nil
    }
}

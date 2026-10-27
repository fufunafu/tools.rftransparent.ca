import { getResend } from "@/lib/resend";
import {
  buildOnboardingHtml,
  buildOnboardingText,
  type OnboardingMessage,
} from "@/lib/onboarding-message";

const FROM = "RF Transparent <info@glass-railing.com>";

export type { OnboardingMessage, OnboardingMessageRow } from "@/lib/onboarding-message";

/**
 * Best-effort welcome for an employee who has already been created.
 * A refused email must never undo the profile and the access rows that were
 * written before it.
 *
 * The message carries the passwords the admin typed on the form. They are
 * never logged here — a failure records the provider's error, never the body.
 */
export async function sendOnboardingEmail(message: OnboardingMessage): Promise<boolean> {
  const subject = `Your RF Transparent accounts${message.name ? `, ${cleanHeaderText(message.name)}` : ""}`;

  try {
    const { error } = await getResend().emails.send({
      from: FROM,
      to: message.email,
      subject,
      text: buildOnboardingText(message),
      html: buildOnboardingHtml(message),
    });

    if (error) {
      console.error("[onboarding] Resend rejected the email:", error);
      return false;
    }
    return true;
  } catch (error) {
    console.error("[onboarding] email send failed:", error);
    return false;
  }
}

function cleanHeaderText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim().slice(0, 120);
}

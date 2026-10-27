# Employee survey program

RF Tools runs employee surveys through Meta's WhatsApp Cloud API. Survey results are management-only. Public survey pages are protected by unique recipient tokens.

## Program schedule

The hourly survey dispatcher evaluates all dates and times in `America/Toronto`:

- Weekly pulse: Thursday at 3:00 PM
- Response window: Thursday afternoon through Tuesday at 9:00 AM
- Nonresponder reminder: Monday at 9:00 AM
- Quarterly engagement survey: the first Thursday of January, April, July, and October
- The weekly pulse is not created during quarterly survey week
- Onboarding surveys: day 14, 45, and 90 after `employees.hire_date`
- Exit survey: once, voluntarily, within 30 days after `employees.employment_ended_at` when enabled
- Targeted surveys: created manually after a meaningful event and require the decision the results will support

Vercel invokes `/api/cron/send-employee-surveys` hourly at minute 25. Off-schedule invocations are safe no-ops. Campaign and recipient dedupe keys make retries idempotent.

## WhatsApp templates

Create and approve these templates in WhatsApp Manager.

### Survey invitation

- Environment name: `WHATSAPP_SURVEY_TEMPLATE_NAME`
- Suggested template name: `employee_survey`
- Body: `Hi {{name}}. A new employee survey is ready. It takes only a few minutes: {{link}}. This link is private, so please do not share it.`

The body uses named parameters `name` and `link`.

### Nonresponder reminder

- Environment name: `WHATSAPP_SURVEY_REMINDER_TEMPLATE_NAME`
- Suggested template name: `employee_survey_reminder`
- Body: `Hi {{name}}. This is a reminder that your employee survey is still open: {{link}}. Please do not share this private link.`

It uses the same `name` and `link` parameters. When the reminder variable is absent, RF Tools falls back to the invitation template.

### Monthly employee update

- Environment name: `WHATSAPP_EMPLOYEE_UPDATE_TEMPLATE_NAME`
- Suggested template name: `employee_feedback_update`
- Body: `Hi {{name}}. You said: {{title}}. We did: {{update}}.`

The body uses named parameters `name`, `title`, and `update`. Management reviews and explicitly publishes these messages from Employees, Team surveys.

### Birthday greeting

- Environment name: `WHATSAPP_BIRTHDAY_GREETING_TEMPLATE_NAME`
- Suggested template name: `employee_birthday_greeting`
- Body: `Happy birthday, {{name}}! Wishing you a wonderful day from everyone at RF Transparent.`

The body uses the named parameter `name`.

### Coworker birthday reminder

- Environment name: `WHATSAPP_BIRTHDAY_REMINDER_TEMPLATE_NAME`
- Suggested template name: `employee_birthday_reminder`
- Body: `Hi {{name}}, today is {{birthday_name}}'s birthday. Please take a moment to wish them a happy birthday!`

The body uses named parameters `name` and `birthday_name`. The daily automation sends the greeting to each active birthday employee and sends this reminder to every other active employee at approximately 9:35 AM Toronto time.

## Environment variables

Configure these values in Vercel for every environment that sends messages:

```text
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_SURVEY_TEMPLATE_NAME=employee_survey
WHATSAPP_SURVEY_REMINDER_TEMPLATE_NAME=employee_survey_reminder
WHATSAPP_EMPLOYEE_UPDATE_TEMPLATE_NAME=employee_feedback_update
WHATSAPP_BIRTHDAY_GREETING_TEMPLATE_NAME=employee_birthday_greeting
WHATSAPP_BIRTHDAY_REMINDER_TEMPLATE_NAME=employee_birthday_reminder
WHATSAPP_TEMPLATE_LANGUAGE=en_US
WHATSAPP_GRAPH_API_VERSION=v24.0
WHATSAPP_APP_SECRET=
WHATSAPP_WEBHOOK_VERIFY_TOKEN=
SURVEY_RESTRICTED_ACCESS_EMAILS=
```

Use a permanent system-user access token. The phone-number ID is the Meta asset ID, not the visible phone number. Employee phone numbers must use international format such as `+14165550123`.

`SURVEY_RESTRICTED_ACCESS_EMAILS` is a comma-separated list of the small management group allowed to review named exit responses. The owner always has this access. Ordinary managers can review weekly, onboarding, and targeted named responses plus quarterly aggregates, but cannot retrieve exit campaigns or answers.

## Delivery-status webhook

Configure the WhatsApp webhook callback as:

```text
https://tools.rftransparent.ca/api/webhooks/whatsapp
```

Use `WHATSAPP_WEBHOOK_VERIFY_TOKEN` as the verification token and subscribe to message status events. RF Tools verifies every POST using `WHATSAPP_APP_SECRET` and `X-Hub-Signature-256`, then records delivered or failed status against the provider message ID.

Opening the survey link separately records `opened_at`. Submitting records `completed_at`, so campaign reporting distinguishes sent, delivered, opened, and completed.

## Safe test mode

Configure both values to limit a campaign to one employee and redirect that employee's messages to a test number:

```text
WHATSAPP_TEST_RECIPIENT=+16477404552
WHATSAPP_TEST_EMPLOYEE_ID=7e6e6237-892e-43ef-b707-87106a29cf5f
```

When only one value is present, sending stops with a configuration error. Remove both values for normal employee-wide delivery.

## Privacy model

- Weekly, onboarding, and targeted surveys are named. The response page clearly explains this before submission.
- Quarterly answers are stored without recipient or employee identifiers. Department and location snapshots remain available only for aggregate reporting, and groups under five responses are suppressed.
- Exit surveys are named and restricted to the owner and `SURVEY_RESTRICTED_ACCESS_EMAILS`. They appear in a separate restricted section, never in weekly reporting.
- Only management API routes can load survey reporting or mutate actions.
- Written answers are retained for the campaign's configured period, 365 days by default, then cleared by the dispatcher.
- Survey data is excluded from commissions, employee KPI calculations, discipline, and compensation workflows.

## Management workflow

1. Tuesday morning, management reviews the closed weekly pulse.
2. A weekly overall score of 1 or 2, or an explicit follow-up request, creates a private review item automatically.
3. The review item is due in two business days. Acknowledge it when contact begins.
4. Team-wide issues must be recorded with an owner and due date.
5. Draft and publish one “You said, we did” update each month.
6. The dashboard reports overdue actions, completion time, acknowledgment SLA, four-week trends, medians, distributions, response rate, delivery, and recurring written-feedback terms.

## Migration and verification

Apply `supabase/migrations/20260813123000_employee_survey_program.sql`. It creates the normalized program tables, seeds all templates and questions, and backfills legacy `employee_surveys` records into campaign history without deleting the legacy table.

After deployment:

1. Set employee hire dates and any employment end dates.
2. Configure and approve the three WhatsApp templates.
3. Configure the signed delivery-status webhook.
4. Run Employee survey program from Settings, Automations or send a weekly pulse from Employees, Team surveys.
5. Confirm one invitation moves from sent to delivered, opened, and completed.
6. Confirm a score of 1 or 2 creates a private review item.
7. Confirm an ordinary employee receives HTTP 403 from `/api/kpi/employees/surveys`.
8. Confirm a four-person quarterly group is shown as suppressed and a five-person group is reported only in aggregate.

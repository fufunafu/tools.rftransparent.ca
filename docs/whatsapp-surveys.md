# WhatsApp employee surveys

Weekly employee surveys are sent directly through Meta's WhatsApp Cloud API.

## Message template

Create and approve a WhatsApp message template in WhatsApp Manager with these values:

- Name: `weekly_checkin`
- Language: `en`
- Body: `Hi {{name}}! It is time for your weekly check-in. Please take 2 minutes to share how you are doing this week: {{link}} Please do not share this private link.`

The first body parameter is the employee name. The second is the unique survey URL. If Meta assigns a different category or you choose a different template name or language, use the approved values in the environment variables below.

## Environment variables

Configure these values in Vercel for every deployed environment that sends surveys:

```text
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
WHATSAPP_SURVEY_TEMPLATE_NAME=weekly_checkin
WHATSAPP_TEMPLATE_LANGUAGE=en
WHATSAPP_GRAPH_API_VERSION=v24.0
```

Use a permanent system-user access token with permission to send WhatsApp business messages. The phone-number ID is the Meta asset ID, not the visible phone number.

The WhatsApp asset currently configured in `Welly-box-DUPE` is Meta's test number. It is suitable for validating this integration with approved test recipients, but production employee surveys need a registered business phone number and its matching permanent token.

Employee phone numbers must use international format, such as `+14165550123`. Spaces, parentheses, periods, and hyphens are accepted and removed before sending.

## Safe test mode

Configure both values to limit the scheduled job to one employee and redirect that employee's message to a test number:

```text
WHATSAPP_TEST_RECIPIENT=+16477404552
WHATSAPP_TEST_EMPLOYEE_ID=7e6e6237-892e-43ef-b707-87106a29cf5f
```

When either value is missing, the job stops with a configuration error. Remove both values to return to normal employee-wide delivery.

## Verification

After the template is approved and the variables are configured:

1. Open Settings, then Automations.
2. Run Employee surveys manually.
3. Confirm the run reports a sent count with no errors.
4. Confirm the recipient receives the message and the survey link opens.
5. Open System health and confirm WhatsApp Cloud API is operational.

Failed sends are removed from the current week's survey records so a later run can retry them.

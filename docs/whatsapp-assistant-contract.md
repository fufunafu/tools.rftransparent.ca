# WhatsApp assistant context contract

InvoiceBox must call `POST /api/internal/whatsapp/employee-context` for every
inbound employee message. Employee lookup alone is not sufficient because
knowledge retrieval depends on the current message.

## Request

```json
{
  "phone": "+14165550100",
  "message": "When was RF Transparent created?",
  "messages": [
    { "role": "user", "content": "Tell me about RF Transparent." },
    { "role": "assistant", "content": "What would you like to know?" }
  ]
}
```

`messages` is optional and should contain up to the last eight user and
assistant messages before the current message.

## Response usage

The response uses `contractVersion: 2` and is never cacheable. For every model
call, InvoiceBox must:

1. Use `initialPrompt` as the assistant's base instructions.
2. Add `knowledgeContext` to the model context for that message.
3. Answer only from `knowledgeContext` when it is non-empty.
4. Use the configured fallback when `retrieval.matched` is false.
5. Keep `retrieval.citations` in logs for diagnosis and evaluation.

The `knowledge` array remains available as structured data. `knowledgeContext`
is the canonical ready-to-inject representation and avoids downstream prompt
formatting differences.

For compatibility, callers that omit `message` receive up to 20 active answers
allowed for that employee's department and location. These responses use
`retrieval.mode: "compatibility"`. This fallback is bounded and should not
replace per-message retrieval.

## Evaluation request (reverse direction)

Running quality checks from the settings page calls
`POST {INVOICEBOX_URL}/api/internal/assistant/evaluate` with the same shared
secret. The request body contains `initialPrompt`, `question`,
`expectedAnswer`, `employee`, `knowledge`, and — since 2026-08 —
`knowledgeContext`: the same ready-to-inject string production sends, so
evaluation runs match production prompting. InvoiceBox may ignore
`knowledgeContext` until it adopts it; the field is additive.

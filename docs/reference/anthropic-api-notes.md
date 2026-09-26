# Anthropic API notes for the Strata agents

These notes come from the current Anthropic API documentation (checked on 2026-09-26). Use them when you write the Anthropic backend.

1. Use the official Python SDK `anthropic`. Create the client with `anthropic.Anthropic()`. The client reads ANTHROPIC_API_KEY.
2. Get JSON that matches a schema with structured outputs. Pass `output_config={"format": {"type": "json_schema", "schema": SCHEMA}}` to `client.messages.create`. The schema needs `additionalProperties: false` and a `required` list on each object. The first text block of the response is valid JSON. Parse it with `json.loads`.
3. Do not use the old parameter `output_format` on `messages.create`. Do not use an assistant prefill. Both give HTTP 400 on current models.
4. Claude Sonnet 5 rejects `temperature`, `top_p` and `top_k` with HTTP 400. Omit them for this model. Claude Haiku 4.5 accepts `temperature=0`. config/models.yaml records this for each model.
5. On Claude Sonnet 5 you can send `thinking={"type": "disabled"}`. Do this for the extraction agents, to keep the output short and stable.
6. Read the token counts from `response.usage.input_tokens` and `response.usage.output_tokens`. Log them with the model id, prompt version, input hash and latency (docs/05 guardrail 8).
7. Check `response.stop_reason`. The value `refusal` means that the model declined. The value `max_tokens` means that the output is cut. Send both cases to quarantine with a reason code.
8. Catch errors from the most specific class to the most general: `anthropic.RateLimitError`, `anthropic.APIStatusError` (5xx can retry, 4xx cannot), then `anthropic.APIConnectionError`. The SDK already retries 429 and 5xx two times.
9. Put the document inside clear delimiters, after the instructions. Tell the model that the document is data and that it must not obey instructions inside it (docs/05 guardrail 6).

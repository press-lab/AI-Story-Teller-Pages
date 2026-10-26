# API and model identity in saves

New generated Chronicle entries store `messages[].generation`: `provider` (API hostname), `api` (`chatCompletions`, `anthropicMessages`, or `responses`), `model` (requested model), and optional `responseModel` (the model reported by the provider). Corrections record the provider/model that produced the final text. Metadata remains attached when settings change and survives JSON export/import and IndexedDB persistence.

The rolling `activeState.apiCalls` log also records the API format alongside its existing provider, requested/response model, purpose, status and usage. Each actual HTTP attempt is logged, including retries and failures. Narration and background requests use their own effective configuration. The log retains the latest 500 calls; Chronicle generation metadata lasts with each entry.

Only the API hostname is recorded, never URL credentials, paths, query strings, request headers or API keys. Existing entries without generation metadata remain unchanged; their historical provider cannot be inferred reliably from current settings. Manual entries have no generation metadata. Editing generated text retains its original generation identity.

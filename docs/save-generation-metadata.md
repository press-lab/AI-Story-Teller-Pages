# API and model identity in saves

New generated Chronicle entries store `messages[].generation`: `provider` (API hostname), `api` (`chatCompletions`, `anthropicMessages`, or `responses`), `model` (requested model), and optional `responseModel` (the model reported by the provider). Corrections record the provider/model that produced the final text. Metadata remains attached when settings change and survives JSON export/import and IndexedDB persistence.

The rolling `activeState.apiCalls` log also records the API format alongside its existing provider, requested/response model, purpose, status and usage. Each actual HTTP attempt is logged, including retries and failures. Narration and background requests use their own effective configuration. The log retains the latest 500 calls; Chronicle generation metadata lasts with each entry.

Only the API hostname is recorded, never URL credentials, paths, query strings, request headers or API keys. Existing entries without generation metadata remain unchanged; their historical provider cannot be inferred reliably from current settings. Manual entries have no generation metadata. Editing generated text retains its original generation identity.

## App commit in save logs

New `activeState.apiCalls[]` records and `messages[].generation` include `appCommit`, the build-time Git commit displayed in the app footer (or `dev` for a build without Git information). It identifies the app build that made the request, including failed and background requests. Each record retains its original commit through later builds, JSON export/import and database saves. Old records are not backfilled with the current commit.

This field is debugging metadata in the saved adventure only. It is not added to model prompts, context, request headers or request bodies.

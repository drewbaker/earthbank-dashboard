The Earth Bank Dashboard API is what the dashboard itself uses. Every route lives under `/v1` on `dashboard.theearthbank.org` and needs a signed-in session cookie.

**Errors** always look like `{ "error": { "code": "validation_error", "message": "…", "details": [{ "path": "name", "message": "…" }] } }`. The `code` is a stable snake_case string; `details` appears on 422 validation errors.

**Lists** return `{ "data": [...], "next_cursor": "…", "has_more": true }`. Pass `cursor=<next_cursor>` to get the next page.

**Writes** must come from the dashboard's own origin (an `Origin` header matching the app URL).

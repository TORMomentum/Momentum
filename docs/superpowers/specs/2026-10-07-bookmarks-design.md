# Saved TOR bookmarks

Bookmarks are vendor-owned pointers to TOR ids.  The unique `(accountId, torId)`
index is the concurrency guarantee: saving uses an insert and treats only a
duplicate-key response as success, rather than doing a racy read first.

The bookmarks repository is the sole code that addresses the `bookmarks`
collection.  The TOR repository verifies a save target exists and supplies a
minimal public row projection.  A restricted or otherwise non-public TOR is
never returned from a bookmark list, although its pointer remains owned data
and therefore remains present in PDPA export and account deletion.

`GET /me/bookmarks` returns rows for the profile. `GET /me/bookmarks/ids`
accepts the page's id query values and returns only saved ids, so search marks a
page in one query. Writes go through the existing cookie-owning Next handler,
which performs browser-origin validation; API routes repeat the same-origin
check and use the existing auth rate limiters.

The server reads bookmark state before rendering. Client controls update their
own state optimistically and restore the previous value if the proxied request
fails. No session identifier or API base URL is exposed to browser code.

# Upgrading Third Eye

## TL;DR — safe upgrade procedure

Before upgrading, back up your data file (it's just one SQLite file):

```bash
cp server/data/codeburn.db server/data/codeburn.db.bak-$(date +%Y%m%d)
```

Then pull and restart:

- **Docker:** `docker compose pull && docker compose up -d --build`
- **Node:** `git pull && npm install && npm start`

That's it. The server runs schema migrations automatically on startup and
your data stays intact.

## What happens to my data?

Third Eye uses SQLite — a single file at `server/data/codeburn.db`. Your
data is never deleted, modified destructively, or re-imported across
upgrades. Schema changes are additive (new columns with defaults, new
tables) and applied idempotently — restarting an already-upgraded server
is safe and a no-op.

New columns on existing tables are created with sensible defaults (`NULL`
for text, `0` for integers / booleans), so existing rows get valid values
automatically without any re-ingest.

## When do I need to re-ingest?

Almost never. Re-ingest is only needed if:

- A release adds a new column on `api_calls` and you want the new field
  populated for historical sessions — otherwise it stays at the default
  for old rows; new rows get it correctly from then on.
- You suspect the DB got corrupted. Use `npm run ingest:rebuild`, which
  **wipes and re-ingests from scratch** — destructive, regenerates project
  UUIDs, breaks any `#/project/<uuid>` bookmarks, asks for confirmation.

For most upgrades, just restart and you're done.

## Rollback

If a new version misbehaves:

```bash
# stop the server first

git checkout v1.X.Y                                             # the version you want
cp server/data/codeburn.db.bak-YYYYMMDD server/data/codeburn.db  # restore backup

# restart:
docker compose up -d --build        # Docker
# or
npm install && npm start            # Node
```

Note: rolling back to an older tag does **not** remove columns added by
the newer version — they stay in the DB, but the older code ignores them.
Your data and functionality are unaffected.

If you didn't back up and need to get back to a clean state, the
destructive fallback is `npm run ingest:rebuild` — regenerates everything
from your session files.

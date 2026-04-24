# Coordinated release checklist

Delta-V ships the Worker and static assets as a single version line, as described in the architecture documentation. Use this checklist whenever you increment the game-state schema version, change the shape of server-to-client or client-to-server protocol messages, alter the semantics of replay projection, or run a database migration that touches live tables.

## Engine and protocol

Update the schema version constant in the shared domain types module and adjust any dependent validators in the shared protocol module. Then run the full type-check pass and the test coverage suite to confirm nothing is broken.

## Replay and recovery

Extend or adjust the projector and archive tests inside the server game-do folder if the meaning of the event stream has changed. If checkpoints or envelope layout changed, manually spot-check one archived match using either the replay route or an export from the object-storage bucket.

## Agents and MCP

MCP here stands for Model Context Protocol. Refresh the agent playbook configuration file and any agent-facing documentation if the set of legal actions or phase rules has changed. Then run the MCP and bridge smoke test, following the quick-start steps in the agents documentation, against either a local or staging Worker.

## Database migrations (forward-only)

Add any new migration as a numbered SQL file under the migrations directory — the filename ordering is authoritative. Apply migrations locally using the Wrangler database-migrations-apply command with the local flag; the continuous-integration job and the pre-push hook already do this. The deploy job runs the same migration-apply command with the remote flag before the Worker deploys. Remember: rollback is "redeploy previous Worker on a compatible schema", not automatic down-migration.

## Client bundle

Run the build command so that the version manifest picks up a new assets hash. The build now minifies the client bundle on every invocation, so the baseline is roughly 397 kilobytes raw and 117 kilobytes gzipped. Confirm that the main HTML entry point's query-string cache-busting parameters reference the new hash.

## Deploy

Deploy the Worker and static assets together using the deploy command or the continuous-integration deploy job. After the deploy completes, request the version manifest from the deployed host and confirm that the package version and assets hash both match what you expect for this release.

If old HTML is cached at the edge, a mismatch between the assets hash and server behavior is a strong hint that something went wrong. Correlate that with spikes in the database client-error log or telemetry to pinpoint the issue.

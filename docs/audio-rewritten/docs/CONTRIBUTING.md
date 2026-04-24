# Contributing

This document covers the contributor workflow only. The readme handles onboarding, the architecture document covers system design, and the coding standards document covers conventions.

## Pre-commit (Husky)

The pre-commit hook is now the cheap local gate.

If the staged diff is documentation-only — limited to the readme, the agent specification, the docs directory, or the patterns directory — it runs only the doc-links check.

For non-documentation changes, it runs the following in order. First, it runs the lint check. Next, it performs a set of boundary checks using text search — these will fail the commit if any violations are found. Specifically, it checks for direct inner-HTML assignment outside the dedicated DOM helper module, which requires using the set-trusted-HTML helper instead; for use of the built-in random number generator inside the shared engine directory, which requires using an injected random number generator; and for any console log, warn, or error calls inside the shared layer, which must remain side-effect free. After the boundary checks, it runs a full typecheck across all packages.

## Pre-push (Husky)

The pre-push hook is the fast local push gate by default.

If the pushed diff is documentation-only — under the same four paths as the pre-commit hook — it runs only the doc-links check.

For non-documentation pushes it runs, in order: the lint script; the same text-search boundary checks as pre-commit; the full typecheck; the build; and the simulate-smoke script, but only when AI, agent, engine, scenario, or simulation files changed.

Continuous integration still runs the full verification list — coverage, browser smoke, accessibility, the sixty-iteration simulation sweep in continuous-integration mode, deploy dry-run, and deployment checks.

To run the exhaustive local gate before pushing, set the full-pre-push environment variable to one before invoking git push. That mode runs the local database migration setup, fresh coverage, Playwright smoke, Playwright accessibility, and the sixty-iteration simulation sweep before allowing the push.

### Coverage

The coverage test run executes two sequential Vitest coverage passes. The client tests write reports under the coverage-client directory, and the server, shared, and MCP tests write reports under the coverage-server-shared directory.

Each pass still uses the no-file-parallelism flag, but the real fix is that the two suites no longer share one coverage temp directory. If coverage fails unexpectedly, remove the coverage directory and retry.

Both the standard test command and the coverage test command set a Node options environment variable pointing to a local-storage file under the temporary directory, which silences experimental web-storage warnings that appear in Node version 25 and later.

### Playwright ports

The default port for Playwright end-to-end tests is 8787.

In continuous integration, the end-to-end smoke and accessibility suites run on port 8787. In full pre-push mode, a free TCP port is chosen dynamically via Node, the end-to-end port environment variable is set, and a pre-commit end-to-end flag is set so that Playwright does not attempt to reuse an existing server — this avoids accidentally attaching to a running development server. To run end-to-end tests manually while a development server is already holding the default port, set the end-to-end port environment variable to any other free port before running the end-to-end test command.

### Windows

The pre-commit hook is a POSIX shell script. On Windows, use Git Bash, WSL, or a similar POSIX-compatible shell.

### Skipping hooks (emergency only)

You can bypass the pre-commit hook by passing a no-verify flag to the git commit command. This skips all checks, which continuous integration will then catch and fail on — so prefer fixing the underlying issue instead.

## Full verification

The verify script runs the full local release gate in sequence: lint, typecheck for both the application and tools, coverage, build, Playwright smoke, accessibility end-to-end, and the sixty-iteration simulation sweep in continuous-integration mode. Use the quick verify script for the fast lint, typecheck, and build gate.

## Documentation

Each topic has a single owner document. Update documentation when behavior or architecture decisions materially change, and prefer adding anchored sections to existing files over creating new ones. The review plan document tracks the recurring review cadence, and the backlog document tracks open work.

After editing documentation, run the doc-links check command. It walks every linked reference under the readme, the agent specification document, the docs directory, and the patterns directory, verifying that files exist and that anchors match heading slugs.

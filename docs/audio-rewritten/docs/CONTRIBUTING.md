# Contributing

This document covers the contributor workflow only. The readme handles onboarding, the architecture document covers system design, and the coding standards document covers conventions.

## Pre-commit (Husky)

The pre-commit hook runs a series of checks in order before any commit is accepted.

First, it runs the lint check. Next, it performs a set of boundary checks using text search — these will fail the commit if any violations are found. Specifically, it checks for direct inner-HTML assignment outside the dedicated DOM helper module (which requires using the set-trusted-HTML helper instead), for use of the built-in random number generator inside the shared engine directory (which requires using an injected random number generator instead), and for any console log, warn, or error calls inside the shared layer (which must remain side-effect free).

After the boundary checks, it runs a full typecheck across all packages. Then it applies any pending local database migrations. Next, it clears the coverage directory and runs the full test suite with coverage reporting. It then runs Playwright browser smoke tests with end-to-end testing enabled, followed by Playwright accessibility baseline tests using the axe tool. Finally, it runs a headless simulation sweep across all nine scenarios for sixty iterations.

Continuous integration runs the same list, except for the local database setup step.

### Coverage

The coverage test run uses a flag to disable file parallelism so that the coverage file merger does not encounter race conditions on its temporary files. If coverage fails unexpectedly, removing the coverage directory and retrying is the recommended fix.

Both the standard test command and the coverage test command set a Node options environment variable to silence experimental web-storage warnings that appear in Node version 25 and later.

### Playwright ports

The default port for Playwright end-to-end tests is 8787.

In continuous integration, end-to-end tests run on that default port. In the pre-commit hook, a free TCP port is chosen dynamically via Node, and a flag is set so that Playwright does not attempt to reuse an existing server — this avoids accidentally attaching to a running development server. To run end-to-end tests manually while a development server is already holding the default port, you can set the port environment variable to any other free port before running the end-to-end test command.

### Windows

The pre-commit hook is a POSIX shell script. On Windows, use Git Bash, WSL, or a similar POSIX-compatible shell.

### Skipping hooks (emergency only)

You can bypass the pre-commit hook by passing a no-verify flag to the git commit command. This skips all checks, which continuous integration will then catch and fail on — so prefer fixing the underlying issue instead.

## Full verification

The verify command runs the full local release gate in sequence: lint, typecheck for both the application and tools, coverage, build, end-to-end tests, accessibility end-to-end tests, and a headless simulation sweep. The simulation sweep uses forty iterations when run via the verify command, compared to sixty iterations in pre-commit and continuous integration, to keep it responsive when invoked by hand.

## Documentation

Each topic has a single owner document. Update documentation when behavior or architecture decisions materially change, and prefer adding anchored sections to existing files over creating new ones. The review plan document tracks the recurring review cadence, and the backlog document tracks open work.

After editing documentation, run the doc-links check command. It walks every linked reference under the readme, the agent specification document, the docs directory, and the patterns directory, verifying that files exist and that anchors match heading slugs.

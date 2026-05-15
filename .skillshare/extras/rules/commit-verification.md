# Commit & Verification

## General

- Conventional Commits, English. Commit message answers *why*, not *what*.
- Never `--no-verify`.
- Use pnpm for JavaScript tooling inside the devcontainer. Root `package.json` and `pnpm-lock.yaml` are intentional repo-level dev tooling for Husky + lint-staged; app/runtime UI dependencies stay under `ui/`.

## Devcontainer

- **Run all UI and CLI verification inside the devcontainer / Docker environment.** Do not run `go test`, `go vet`, `pnpm`, Vite, or CLI smoke checks on the host unless the user explicitly asks for a host-only check.
- If not already inside the devcontainer, enter it first with `make devc` (or `./scripts/devc.sh shell` when the container is already running). Use `/workspace` as the repo root inside the container.
- **Go tests need an executable temp directory in the devcontainer.** If `go test` fails with `fork/exec /tmp/go-build... permission denied`, create `/workspace/tmp/go-tmp` and `/workspace/tmp/go-cache`, then rerun with `GOTMPDIR=/workspace/tmp/go-tmp GOCACHE=/workspace/tmp/go-cache`. This is a container tempdir/noexec issue, not proof that the code is broken.
- For UI review, first ask the user whether they are already inside the devcontainer. Once confirmed, run `ui` inside the devcontainer. The UI is served at `http://127.0.0.1:5174` and the API at `19520`.
- **Custom devcontainer ports must be checked for host Vite collisions.** When running with `PORT=N`, the UI port is `N - 19520 + 5174`; before trusting the browser, run `lsof -nP -iTCP:<ui-port> -sTCP:LISTEN` on the host and confirm the listener is Docker/OrbStack, not a host `node ... vite` process. A stale host Vite can serve old main-branch UI on the same port while the devcontainer API is correct, making feature work look missing.
- CLI / server changes must be smoke-tested inside the devcontainer with the project CLI or `go run ./cmd/aisets ...` command that matches the changed behavior.

## UI Commit Checklist

A UI commit must:
- Touch the relevant TSX / SCSS tokens
- Touch `DESIGN.md` if any design-surface delta exists
- Inside the devcontainer, pass `go test ./...` and `go vet ./...` (UI changes can break Go-side embed tests)
- Inside the devcontainer, pass the relevant UI checks such as `pnpm --dir ui lint`, `pnpm --dir ui test`, and/or `pnpm --dir ui build`
- Render correctly at 1440 / 1024 / 768 / 375 widths in **both dark mode (canonical) and light mode** via `http://127.0.0.1:5174`. Light mode has different surface/border contrast — visual issues invisible in dark mode (white-on-white, missing borders, washed-out controls) must be caught before delivery.

## Backend Commit Checklist

A backend logic commit must:
- Add or update Go tests for every changed behavior under `cmd/` or `internal/`
- Inside the devcontainer, pass `go test ./...`, `go vet ./...`, and `mkdir -p tmp && go test ./... -coverprofile=tmp/backend-coverage.out`
- Inspect `go tool cover -func=tmp/backend-coverage.out` for newly added or modified backend functions and avoid untested logic regressions

## CI

- CI must mirror local verification via `.github/workflows/test.yaml`. The release workflow must depend on that reusable test workflow before publishing artifacts.

## Air Hot-Reload

- **Multi-file Go edits can break `air` hot-reload.** The devcontainer uses `air` to watch Go files and rebuild. Editing call sites before updating function signatures creates intermediate compilation errors. `air` detects each file save, fails to compile, and the old binary keeps serving on the port. When the fix lands and `air` tries again, it can't bind the port (`address already in use`). After multi-file Go changes, check `/tmp/aisets-api-dev.log` inside the container for compilation errors. If the server didn't restart, run `ui stop && ui`.

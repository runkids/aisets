BINARY ?= bin/asset-studio

.PHONY: help build test fmt vet check devc devc-up devc-down devc-restart devc-reset devc-status ui-install ui-build ui-dev build-all

help:
	@echo "Common tasks:"
	@echo "  make build          # build binary"
	@echo "  make test           # run Go tests"
	@echo "  make check          # vet + test"
	@echo "  make ui-dev         # Go API server + Vite dev server"
	@echo "  make devc           # start devcontainer + enter shell"
	@echo "  make devc-up        # start devcontainer"
	@echo "  make devc-down      # stop devcontainer"
	@echo "  make build-all      # ui-build + build"

build:
	mkdir -p $(dir $(BINARY))
	go build -o $(BINARY) ./cmd/asset-studio

test:
	go test ./...

fmt:
	gofmt -w ./cmd ./internal

vet:
	go vet ./...

check: vet test

devc:
	./scripts/devc.sh up && ./scripts/devc.sh shell

devc-up:
	./scripts/devc.sh up

devc-down:
	./scripts/devc.sh down

devc-restart:
	./scripts/devc.sh restart

devc-reset:
	./scripts/devc.sh reset

devc-status:
	./scripts/devc.sh status

ui-install:
	cd ui && pnpm install

ui-build:
	cd ui && pnpm run build

ui-dev:
	@trap 'kill 0' EXIT; \
	air & \
	cd ui && pnpm run dev

build-all: ui-build build

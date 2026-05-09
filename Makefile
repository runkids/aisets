BINARY ?= bin/aisets
IMGTOOLS_DIR = tools/imgtools

.PHONY: help build test fmt vet check devc devc-up devc-down devc-restart devc-reset devc-status ui-install ui-build ui-dev build-all imgtools imgtools-test

help:
	@echo "Common tasks:"
	@echo "  make build          # build binary"
	@echo "  make test           # run Go tests"
	@echo "  make check          # vet + test"
	@echo "  make ui-dev         # Go API server + Vite dev server"
	@echo "  make devc           # start devcontainer + enter shell"
	@echo "  make devc PORT=N    # start on custom port (UI auto-derives)"
	@echo "  make devc-up        # start devcontainer"
	@echo "  make devc-down      # stop devcontainer"
	@echo "  make build-all      # ui-build + build"

build:
	mkdir -p $(dir $(BINARY))
	go build -o $(BINARY) ./cmd/aisets

test:
	go test ./...

fmt:
	gofmt -w ./cmd ./internal

vet:
	go vet ./...

check: vet test imgtools-test

PORT_FLAG = $(if $(PORT),--port $(PORT),)

devc:
	./scripts/devc.sh up $(PORT_FLAG) && ./scripts/devc.sh shell $(PORT_FLAG)

devc-up:
	./scripts/devc.sh up $(PORT_FLAG)

devc-down:
	./scripts/devc.sh down $(PORT_FLAG)

devc-restart:
	./scripts/devc.sh restart $(PORT_FLAG)

devc-reset:
	./scripts/devc.sh reset $(PORT_FLAG)

devc-status:
	./scripts/devc.sh status $(PORT_FLAG)

ui-install:
	cd ui && pnpm install

ui-build:
	cd ui && pnpm run build

ui-dev: imgtools-install
	@trap 'kill 0' EXIT; \
	air & \
	cd ui && pnpm run dev

imgtools:
	cargo build --release --manifest-path $(IMGTOOLS_DIR)/Cargo.toml

imgtools-install: imgtools
	mkdir -p $(dir $(BINARY))
	cp $(IMGTOOLS_DIR)/target/release/aisets-imgtools $(dir $(BINARY))

imgtools-embed: imgtools
	mkdir -p internal/imgtools/bin
	cp $(IMGTOOLS_DIR)/target/release/aisets-imgtools internal/imgtools/bin/

imgtools-test:
	cargo test --manifest-path $(IMGTOOLS_DIR)/Cargo.toml
	cargo clippy --manifest-path $(IMGTOOLS_DIR)/Cargo.toml -- -D warnings

build-embed: ui-build imgtools-embed
	mkdir -p $(dir $(BINARY))
	go build -tags embed_imgtools -o $(BINARY) ./cmd/aisets

build-all: ui-build build imgtools-install

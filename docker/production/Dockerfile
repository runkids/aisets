FROM --platform=$BUILDPLATFORM golang:1.25-bookworm AS go-builder
WORKDIR /src
COPY go.mod ./
RUN go mod download
COPY cmd ./cmd
COPY internal ./internal
ARG TARGETOS=linux
ARG TARGETARCH=amd64
RUN CGO_ENABLED=0 GOOS=${TARGETOS} GOARCH=${TARGETARCH} go build -trimpath -ldflags="-s -w -X main.version=docker" -o /aisets ./cmd/aisets

FROM node:22-bookworm AS ui-builder
WORKDIR /src/ui
COPY ui/package.json ui/tsconfig.json ui/vite.config.ts ui/index.html ./
COPY ui/src ./src
RUN corepack enable && pnpm install
RUN pnpm run build

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl tini && rm -rf /var/lib/apt/lists/*
RUN useradd --system --uid 10001 --create-home assetstudio
COPY --from=go-builder /aisets /usr/local/bin/aisets
COPY --from=ui-builder /src/ui/dist /home/assetstudio/.cache/aisets/ui/docker
USER assetstudio
EXPOSE 19520
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["aisets", "ui", "once", "--host", "0.0.0.0", "--port", "19520", "--no-open"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 CMD curl -sf http://localhost:19520/api/health || exit 1

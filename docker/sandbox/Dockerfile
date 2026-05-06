ARG NODE_VERSION=22
ARG PNPM_VERSION=10.28.0
ARG GO_VERSION=1.25

FROM node:${NODE_VERSION}-bookworm-slim AS node-runtime

FROM golang:${GO_VERSION}-bookworm

RUN apt-get update && apt-get install -y --no-install-recommends \
    bash ca-certificates curl git procps tini \
  && rm -rf /var/lib/apt/lists/*

COPY --from=node-runtime /usr/local/bin/node /usr/local/bin/
COPY --from=node-runtime /usr/local/lib/node_modules /usr/local/lib/node_modules

RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack

ARG PNPM_VERSION
RUN npm install -g pnpm@${PNPM_VERSION} \
  && go install github.com/air-verse/air@latest

RUN useradd --create-home --shell /bin/bash developer \
  && mkdir -p /workspace /go/pkg/mod /go/build-cache \
  && chown -R developer:developer /workspace /go /home/developer

WORKDIR /workspace
CMD ["sleep", "infinity"]

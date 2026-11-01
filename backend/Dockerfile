# syntax=docker/dockerfile:1

FROM golang:1.27.3-bookworm AS build
RUN apt-get update && apt-get install -y --no-install-recommends libvips-dev && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/api ./cmd/api && \
    CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/worker ./cmd/worker && \
    CGO_ENABLED=1 go build -trimpath -ldflags="-s -w" -o /out/cli ./cmd/cli

FROM golang:1.27.3-bookworm AS dev
RUN apt-get update && apt-get install -y --no-install-recommends libvips-dev && rm -rf /var/lib/apt/lists/*
RUN go install github.com/air-verse/air@v1.67.4
WORKDIR /src

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends libvips42 ca-certificates tzdata && rm -rf /var/lib/apt/lists/* \
    && groupadd --system --gid 10001 app && useradd --system --uid 10001 --gid app --no-create-home app
COPY --from=build /out/ /usr/local/bin/
USER app
ENV HTTP_ADDR=:8080
EXPOSE 8080
ENTRYPOINT []
CMD ["api"]

FROM golang:1.22-alpine AS base
WORKDIR /src
RUN apk add --no-cache git
COPY go.mod go.sum* ./
RUN go mod download 2>/dev/null || true
COPY . .
RUN go mod tidy

# Go toolchain stage for parser unit tests (final runtime image has no Go).
FROM base AS test
WORKDIR /src
CMD ["go", "test", "./internal/stages/parse/...", "-v"]

FROM base AS build
RUN CGO_ENABLED=0 go build -o /worker .

FROM alpine:3.19
WORKDIR /app
RUN apk add --no-cache ca-certificates git
COPY --from=build /worker /app/worker
ENV PROJECT_ROOT=/app
ENV BOOTSTRAP_ON_START=true
ENV SCAN_ALL_ON_START=true
CMD ["/app/worker"]
# syntax=docker/dockerfile:1.7
# Bare-metal Dockerfile for SEBI CRUD backend.
# Identical to deploy/Dockerfile but pins linux/amd64 in both stages so the
# resulting image is portable to an offline VM via `docker save` / `docker load`.

FROM --platform=linux/amd64 golang:1.25-alpine AS build
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .

ARG VERSION=dev
ARG COMMIT=unknown
ARG BUILD_TIME=unknown

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-s -w -X main.version=${VERSION} -X main.commit=${COMMIT} -X main.buildTime=${BUILD_TIME}" \
    -o /out/server ./cmd/server

FROM --platform=linux/amd64 gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/server /server
USER nonroot:nonroot
EXPOSE 8080
ENTRYPOINT ["/server"]

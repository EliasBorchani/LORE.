# syntax=docker/dockerfile:1
FROM rust:1.99-slim-trixie AS build
WORKDIR /app
COPY . .
# Cache mounts keep downloaded crates and compiled dependencies between builds.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release --locked && cp target/release/server /usr/local/bin/server

FROM debian:trixie-slim
RUN useradd --system --no-create-home server
COPY --from=build /usr/local/bin/server /usr/local/bin/server
USER server
EXPOSE 8080
ENTRYPOINT ["server"]
CMD ["serve"]

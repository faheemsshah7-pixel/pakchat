# Dockerfile: the PakChat server as a release, for our Oracle server (deploy/README.md).
# Builds on the server itself, so it suits Oracle's Arm (Ampere) and AMD machines alike.
# The website and the APK are served by Caddy next to it, not by this image.

FROM elixir:1.17.3-otp-27-slim AS build
RUN apt-get update && apt-get install -y --no-install-recommends build-essential git ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force

# Dependencies first, so a code change doesn't fetch and build them again.
COPY mix.exs mix.lock ./
RUN mix deps.get --only prod
RUN mkdir config
COPY config/config.exs config/prod.exs config/
RUN mix deps.compile

COPY priv priv
COPY lib lib
RUN mix compile
COPY config/runtime.exs config/
COPY rel rel
RUN mix release

# The running server: the release only (it brings its own Erlang).
FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 locales ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && sed -i '/en_US.UTF-8/s/^# //g' /etc/locale.gen && locale-gen
ENV LANG=en_US.UTF-8 LANGUAGE=en_US:en LC_ALL=en_US.UTF-8 MIX_ENV=prod PHX_SERVER=true
WORKDIR /app
# Files and backups people send (locked) live in /data, a volume that outlives the container.
RUN mkdir -p /data/files && chown -R nobody:nogroup /data
COPY --from=build --chown=nobody:root /app/_build/prod/rel/pakchat ./
USER nobody
EXPOSE 4000
# Brings the database up to date, then starts.
CMD ["sh", "-c", "/app/bin/migrate && exec /app/bin/server"]

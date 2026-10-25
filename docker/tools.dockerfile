# syntax=docker/dockerfile:1
#
# Pi Pocket with Python: the stock image (docker/Dockerfile) plus python3 and uv.
#
#   docker build -f docker/tools.dockerfile -t pi-pocket:tools .
#
# The stages before the tools below are the stock image's, line for line and in the
# same order, so this build makes that image first and this file only adds to it. They
# must stay identical: a line copied differently would make Docker build it again, and
# the tools would sit on a different base than pi-pocket:local.
#
# FROM stage AS name is a build-local reference; it does not make the image name that
# writes it a file name.

FROM node:24-bookworm-slim AS deps

WORKDIR /app
COPY package.json package-lock.json ./
# No native modules: a plain install is enough, and the runtime image stays small.
RUN npm ci --omit=dev --ignore-scripts=false \
    && npm cache clean --force

# The runtime image on common tools. It ends before the app source.
FROM node:24-bookworm-slim

ARG CLOUDFLARED_VERSION=latest

ENV DEBIAN_FRONTEND=noninteractive

# The stock image has no python at all. Debian's python is enough for uv: uv reads
# the interpreter of a venv from its pyvenv.cfg, whatever version wrote it.
# `uv python install` cannot help, because UV_PYTHON_DOWNLOADS=0 is set for the
# session: a managed download lives in the container's writable layer and is gone
# on the next recreate.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash \
        ca-certificates \
        curl \
        fd-find \
        fontconfig \
        fonts-dejavu-core \
        fonts-liberation \
        gh \
        git \
        jq \
        less \
        openssh-client \
        procps \
        ripgrep \
        tini \
        xz-utils \
        chromium \
    && ln -sf /usr/bin/fdfind /usr/local/bin/fd \
    && rm -rf /var/lib/apt/lists/*

# Cloudflare Tunnel is optional, but the launcher needs the binary for
# `--access cloudflare` and cannot download it without a terminal.
RUN set -eux; \
    arch="$(dpkg --print-architecture)"; \
    case "$arch" in \
        amd64) cloudflared_arch=amd64 ;; \
        arm64) cloudflared_arch=arm64 ;; \
        *) echo "cloudflared has no release for $arch" >&2; exit 1 ;; \
    esac; \
    curl -fsSL --retry 3 -o /usr/local/bin/cloudflared \
        "https://github.com/cloudflare/cloudflared/releases/${CLOUDFLARED_VERSION}/download/cloudflared-linux-${cloudflared_arch}"; \
    chmod 0755 /usr/local/bin/cloudflared; \
    /usr/local/bin/cloudflared --version

# The app: source, web app, docs it tells Pi about, and types for drop-ins.
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY bin ./bin
COPY src ./src
COPY web ./web
COPY docs ./docs
COPY types ./types
COPY test ./test
COPY README.md AGENTS.md SECURITY.md LICENSE ./

# Pi's folder (sign-ins, settings, skills, sessions) and Pi Pocket's data folder
# are bind mounts in docker-compose.yml. These are the fallbacks for `docker run`.
ENV HOME=/home/node \
    PI_POCKET_DIR=/data \
    PI_POCKET_ACCESS=lan \
    PI_POCKET_PORT=8787 \
    PI_POCKET_BROWSER=/usr/bin/chromium \
    PI_POCKET_BROWSER_ARGS="--no-sandbox --disable-dev-shm-usage" \
    NODE_OPTIONS=--disable-warning=ExperimentalWarning

RUN mkdir -p /data /workspace /home/node/.pi \
    && chmod 0700 /data

WORKDIR /workspace

EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:'+(process.env.PI_POCKET_PORT||8787)+'/style.css').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"

# tini reaps Chromium's children and forwards signals to the launcher. The
# entrypoint clears Chromium's stale profile locks before the app starts.
COPY docker/entrypoint.sh /usr/local/bin/pi-pocket-entrypoint
RUN chmod 0755 /usr/local/bin/pi-pocket-entrypoint

# No arguments by default: an --access argument would override PI_POCKET_ACCESS, and
# the base image's CMD (node) is not one of the launcher's options.
ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/pi-pocket-entrypoint"]
CMD []

# The stock image with Python. Nothing above changes for it, and nothing is copied
# again: this stage is the one that differs.
FROM app AS tools

ARG UV_VERSION=0.13.5

USER root

# The stock image has no python at all. Debian's python is enough for uv: uv reads
# the interpreter of a venv from its pyvenv.cfg, whatever version wrote it.
# `uv python install` cannot help, because UV_PYTHON_DOWNLOADS=0 is set for the
# session: a managed download lives in the container's writable layer and is gone
# on the next recreate.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        build-essential \
        python3 \
        python3-dev \
        python3-venv \
    && rm -rf /var/lib/apt/lists/*

# The installer puts uv and uvx in /usr/local/bin and leaves nothing in ~/.bashrc,
# so the PATH below is the only one that matters.
RUN curl -LsSf https://astral.sh/uv/install.sh \
        | env UV_INSTALL_DIR=/usr/local/bin UV_NO_MODIFY_PATH=1 UV_VERSION="${UV_VERSION}" sh \
    && uv --version \
    && python3 --version

# uv tool install puts each tool's own entry points here. The image runs as root and
# the session runs as the host's uid, so the folder must be writable by anyone:
# `uv tool install ruff` in a session must work.
ENV UV_TOOL_BIN_DIR=/opt/uv-bin
RUN mkdir -p "${UV_TOOL_BIN_DIR}" && chmod 0777 "${UV_TOOL_BIN_DIR}"

# /opt/uv-bin comes before /usr/local/bin, which is already on the image's PATH.
ENV PATH=/opt/uv-bin:/usr/local/bin:/usr/local/sbin:/usr/sbin:/usr/bin:/sbin:/bin

WORKDIR /workspace

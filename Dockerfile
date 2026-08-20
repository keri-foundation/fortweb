# syntax=docker/dockerfile:1

# ---- build stage: compile the TypeScript runtime payload ----
FROM node:22-bookworm-slim AS builder

WORKDIR /src/fortweb

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json tsconfig.build.json pyscript-ci.toml ./
COPY app ./app
COPY tools ./tools
COPY vendor ./vendor
COPY wheels ./wheels

RUN npm run build:runtime

# ---- serve stage: stdlib dev server, non-root ----
FROM python:3.12.10-slim-bookworm AS runtime

RUN useradd -m -u 1000 -s /bin/bash keri

# serve_local.py resolves the fortweb repo by name and serves its parent,
# mirroring the host layout of libs/fortweb (parent libs/).
WORKDIR /workspace/fortweb

COPY --chown=keri:keri scripts ./scripts
COPY --chown=keri:keri app ./app
COPY --chown=keri:keri wheels ./wheels
COPY --chown=keri:keri pyscript-ci.toml ./pyscript-ci.toml
COPY --chown=keri:keri --from=builder /src/fortweb/dist/runtime ./dist/runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

USER keri

EXPOSE 8765

CMD ["python3", "scripts/serve_local.py", "--no-open", "--host", "0.0.0.0", "--port", "8765"]

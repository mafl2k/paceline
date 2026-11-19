# Build from the repo root (the paceline/ folder) so the mod's own engine can be copied in:
#   docker build -f server/Dockerfile -t paceline-server .
FROM node:22-alpine

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080

# The repo layout, so the server modules import the engine as ../pages/src/engine/ here too.
WORKDIR /app/server
# the server's version (server/VERSION, passed by CI and build-push.sh); shown in the start log line
ARG PACELINE_VERSION=dev
ENV PACELINE_VERSION=$PACELINE_VERSION
COPY server/*.mjs ./
COPY pages/src/engine/plan.mjs pages/src/engine/colors.mjs /app/pages/src/engine/

# /data is the volume for paceline.db (all state) and the recordings; the node user (uid 1000) owns it.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080

# The start period covers the 10-minute wait for paceline.db's lock (a dead host's task still holds
# it after a crash) and the one-time import of the file layout at the first start.
HEALTHCHECK --interval=30s --timeout=5s --start-period=12m --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "--disable-warning=ExperimentalWarning", "server.mjs"]

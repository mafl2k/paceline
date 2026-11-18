# Build from the repo root (the paceline/ folder) so the mod's own engine can be copied in:
#   docker build -f server/Dockerfile -t paceline-server .
FROM node:22-alpine

ENV NODE_ENV=production \
    DATA_DIR=/data \
    PORT=8080

WORKDIR /app
COPY server/server.mjs ./server.mjs
COPY pages/src/engine/plan.mjs pages/src/engine/colors.mjs ./engine/

# /data is the volume for the stored plans; the node user (uid 1000) owns it.
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1

CMD ["node", "server.mjs"]

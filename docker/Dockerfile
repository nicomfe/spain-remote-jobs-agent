FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates cron git \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY lib ./lib
COPY scripts ./scripts
COPY mcp ./mcp
COPY web ./web
COPY data/hand.json ./data/hand.json
COPY docker/crontab /crontab

RUN chmod 0755 /app/scripts/daily-crawl.sh \
  && crontab /crontab

# Public JSON is a volume the crawl updates, not a layer in this image.
CMD ["cron", "-f"]

FROM oven/bun:1-alpine AS base
WORKDIR /app

# Install dependencies
FROM base AS deps
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Runtime image
FROM base AS runtime
WORKDIR /app

COPY --from=deps /app/node_modules ./node_modules
COPY src ./src
COPY package.json tsconfig.json ./

# Install curl for health checks and create data dir
RUN apk add --no-cache curl && mkdir -p /app/data && chown -R bun:bun /app
USER bun

VOLUME ["/app/data"]
EXPOSE 8080

CMD ["bun", "run", "src/index.ts"]

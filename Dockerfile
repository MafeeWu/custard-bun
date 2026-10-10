FROM node:24-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@12.5.1 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

FROM deps AS build
COPY . .
ENV NODE_OPTIONS=--max-old-space-size=768
# Build-only placeholders satisfy strict validation. Runtime containers
# revalidate their actual mounted config and environment on startup.
ENV APP_CONFIG_PATH=app.config.yml
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV DATABASE_URL=postgresql://build:build@127.0.0.1:5432/build
ENV BETTER_AUTH_SECRET=build-only-placeholder-secret-32-chars
ENV BETTER_AUTH_URL=http://localhost:3000
ENV SMTP_HOST=127.0.0.1
ENV SMTP_PORT=1025
ENV SMTP_SECURE=false
ENV SMTP_USER=build-only
ENV SMTP_PASSWORD=build-only
ENV SMTP_FROM="Build Only <build@example.com>"
ENV MODEL_API_BASE_URL=http://127.0.0.1:1/v1
ENV MODEL_API_KEY=build-only-model-key
ENV MODEL_ID=build-only-model
RUN pnpm build --webpack && rm -rf .next/cache

FROM base AS runner
ENV NODE_ENV=production
COPY --from=prod-deps /root/.cache/node/corepack /root/.cache/node/corepack
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src ./src
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-lock.yaml ./pnpm-lock.yaml
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/app.config.yml ./app.config.yml
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/tsconfig.json ./tsconfig.json
COPY --from=build /app/next.config.ts ./next.config.ts
EXPOSE 3000
CMD ["pnpm", "start"]

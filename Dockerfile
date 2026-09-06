FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production
ENV APP_ENV=production
ENV HOST=0.0.0.0

RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod
COPY . .

EXPOSE 4187
CMD ["node", "apps/user_client/server.mjs"]

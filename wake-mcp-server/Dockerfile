FROM node:20-slim AS build
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile
COPY tsconfig.json ./
COPY src/ src/
RUN pnpm run build

FROM node:20-slim
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable && pnpm install --frozen-lockfile --prod
COPY --from=build /app/build/ build/
COPY dashboard/ dashboard/
COPY SKILL.md README.md ./

EXPOSE 3000
ENV WAKE_PORT=3000
CMD ["node", "build/index.js", "--http"]

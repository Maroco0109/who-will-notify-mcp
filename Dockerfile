# ---- build stage (devDeps 포함, tsc 컴파일) ----
FROM node:22-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- runtime stage (prod deps만) ----
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
# 베이크 플로어: 런타임 raw fetch 실패 시에도 항상 응답할 수 있는 기본 데이터
COPY data/notices.json ./data/notices.json
EXPOSE 3000
CMD ["node", "dist/index.js"]

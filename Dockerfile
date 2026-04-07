FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY packages/api/package.json ./packages/api/
COPY packages/web/package.json ./packages/web/

# Install all dependencies
RUN npm ci

# Copy source code and config files
COPY packages/shared/ ./packages/shared/
COPY packages/api/ ./packages/api/
COPY packages/web/ ./packages/web/
COPY tsconfig.json ./

# Bust cache: force fresh build
RUN echo "build-v2"

# Build shared types
RUN npm run build -w @summarizer/shared

# Build frontend
RUN npm run build -w @summarizer/web

# Build API (includes copying schema.sql to dist)
RUN npm run build -w @summarizer/api

# Production
ENV NODE_ENV=production
EXPOSE 3001

CMD ["node", "packages/api/dist/index.js"]

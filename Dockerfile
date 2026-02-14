FROM node:22-alpine AS meta
RUN apk add --no-cache git
WORKDIR /app
COPY .git/ .git/
RUN git rev-parse --short HEAD > COMMIT_HASH

FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ src/
RUN npm run build

FROM node:22-alpine
RUN apk add --no-cache ffmpeg
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist/ dist/
COPY --from=meta /app/COMMIT_HASH ./
COPY quips.txt ./
CMD ["node", "dist/index.js"]

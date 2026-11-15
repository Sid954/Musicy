FROM node:22-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY scripts ./scripts

# yt-dlp downloads its runtime binary here on first startup.
RUN mkdir -p /app/data /app/bin && chown -R node:node /app/data /app/bin
USER node
VOLUME ["/app/data"]
CMD ["npm", "start"]

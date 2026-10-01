FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY public ./public
COPY docs ./docs
RUN mkdir -p /app/data && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=3100 BOT_DATA_DIR=/app/data
EXPOSE 3100
CMD ["node", "src/server.js"]

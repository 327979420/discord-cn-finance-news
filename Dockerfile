FROM node:24-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY package.json ./
COPY src ./src
COPY config ./config
RUN mkdir -p /app/data && chown -R node:node /app
USER node
EXPOSE 3000
VOLUME ["/app/data"]
CMD ["node", "src/index.js"]

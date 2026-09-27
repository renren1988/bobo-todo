FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY server.cjs accounts.cjs email.cjs ./
COPY public ./public
RUN mkdir -p .runtime/server && chown -R node:node /app
USER node
ENV HOST=0.0.0.0 PORT=8787
EXPOSE 8787
CMD ["node", "server.cjs"]

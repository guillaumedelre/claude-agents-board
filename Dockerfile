# --- Build du front (Vite + React) ---
FROM node:22-alpine AS web
WORKDIR /web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

# --- Image finale : serveur Node sans dépendance + front compilé ---
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/data
COPY server ./server
COPY --from=web /web/dist ./public
# /data appartient à l'utilisateur non root, pour que le volume nommé hérite des bons droits
RUN mkdir /data && chown node:node /data
USER node
EXPOSE 3000
CMD ["node", "server/server.js"]

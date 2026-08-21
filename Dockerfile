# LilithList community node — zero runtime dependencies.
FROM node:22-alpine

WORKDIR /app
# Only the app + server sources are needed; there is nothing to npm install.
COPY package.json ./
COPY server ./server
COPY index.html app.js styles.css icon.svg ./

# Persist the SQLite database on a mounted volume.
ENV HOST=0.0.0.0 PORT=4173 LILITH_DB=/data/lilithlist.db NODE_ENV=production
VOLUME /data
EXPOSE 4173

RUN addgroup -S ll && adduser -S ll -G ll && mkdir -p /data && chown ll:ll /data
USER ll

CMD ["node", "server/server.mjs"]

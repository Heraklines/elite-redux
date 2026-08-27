FROM node:24-bookworm-slim

RUN npm install --global @openai/codex@0.150.1

WORKDIR /app
COPY container/server.mjs /app/server.mjs

RUN mkdir -p /var/lib/ability-ai/codex /srv/empty && chown -R node:node /var/lib/ability-ai /srv/empty /app

USER node
ENV PORT=8080
ENV HOME=/var/lib/ability-ai
ENV CODEX_HOME=/var/lib/ability-ai/codex
EXPOSE 8080

CMD ["node", "/app/server.mjs"]

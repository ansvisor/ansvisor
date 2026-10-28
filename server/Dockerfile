FROM node:20

ARG VERSION=0.1.0
LABEL org.opencontainers.image.title="Ansvisor Server"
LABEL org.opencontainers.image.version=$VERSION
LABEL org.opencontainers.image.source="https://github.com/ansvisor/ansvisor"
LABEL org.opencontainers.image.licenses="MIT"

WORKDIR /ansvisor-server

COPY package.json package-lock.json* ./

RUN npm install && npm install -g pm2

COPY . .

# Production default — keeps prod log level at info and enables the socket
# origin check. Note: an env_file that sets NODE_ENV overrides this, so
# deployment .env files must not pin NODE_ENV=development.
ENV NODE_ENV=production

EXPOSE 80

CMD ["pm2-runtime", "start", "src/server.js"]

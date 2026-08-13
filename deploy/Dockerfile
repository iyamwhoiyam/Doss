# Build the SPA, then serve it with nginx which also proxies /auth/v1 and
# /rest/v1 to the GoTrue and PostgREST containers (see nginx.conf).
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx.conf /etc/nginx/conf.d/default.conf
COPY deploy/web-env.sh /docker-entrypoint.d/40-shopare-env.sh
RUN chmod +x /docker-entrypoint.d/40-shopare-env.sh

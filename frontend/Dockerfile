FROM node:20-alpine AS build
WORKDIR /app
ARG VITE_API_URL=http://localhost:8000
ENV VITE_API_URL=$VITE_API_URL
COPY package.json package-lock.json* ./
RUN npm ci
COPY . .
RUN npm run build

# Runs as uid 101 and listens on 8080 (no root needed)
FROM nginxinc/nginx-unprivileged:1.31-alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 8080

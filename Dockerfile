# syntax=docker/dockerfile:1
FROM node:22.19-alpine AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM dependencies AS builder
COPY . .
RUN npm run build

FROM node:22.19-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=development
COPY --from=dependencies --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app .
RUN mkdir -p /app/.wrangler && chown -R node:node /app/.wrangler
USER node
EXPOSE 3000
HEALTHCHECK --interval=20s --timeout=5s --start-period=40s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["npm", "run", "dev", "--", "--hostname", "0.0.0.0"]

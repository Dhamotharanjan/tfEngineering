# Build context must be the repo root so `file:../../platform` resolves.
# Compose: context: .  dockerfile: apps/api/Dockerfile
FROM node:20-alpine AS build
WORKDIR /app

# Build @infragraph/platform (CJS dist) before the API installs the file: dependency.
COPY platform/package.json platform/tsconfig.json platform/tsconfig.build.json ./platform/
COPY platform/scripts ./platform/scripts/
COPY platform/src ./platform/src/
WORKDIR /app/platform
RUN npm install && npm run build

# Install & compile Nest API (package.json expects ../../platform from apps/api).
WORKDIR /app
COPY apps/api/package.json apps/api/package-lock.json* ./apps/api/
WORKDIR /app/apps/api
RUN npm install
COPY apps/api/ ./
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
# Keep PROJECT_ROOT at /app so compose volume mounts (./config → /app/config) still work.
ENV PROJECT_ROOT=/app

# Ship built platform for the file: dependency. Clear lifecycle scripts so prod
# install cannot invoke `prepare`/`tsc` (typescript is a platform devDependency).
COPY --from=build /app/platform/package.json ./platform/
COPY --from=build /app/platform/dist ./platform/dist/
RUN node -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('/app/platform/package.json','utf8'));p.scripts={};fs.writeFileSync('/app/platform/package.json',JSON.stringify(p,null,2)+'\n')"

COPY apps/api/package.json apps/api/package-lock.json* ./apps/api/
WORKDIR /app/apps/api
RUN npm install --omit=dev --ignore-scripts
COPY --from=build /app/apps/api/dist ./dist

EXPOSE 8000
CMD ["node", "dist/main.js"]

FROM node:20-alpine

WORKDIR /repo

# Copy workspace manifests first for better layer caching
COPY package.json ./
COPY apps/api/package.json apps/api/package.json
COPY packages/db/package.json packages/db/package.json
COPY packages/shared/package.json packages/shared/package.json
COPY packages/cli/package.json packages/cli/package.json

RUN npm install

# Now copy real source and the Prisma schema, then generate the client + build shared.
# (Requires network access to binaries.prisma.sh during the image build — this is a
# normal Docker build environment, not the restricted sandbox this scaffold was built in.)
COPY packages packages
COPY apps/api apps/api

RUN npm run db:generate \
 && npm run build --workspace=packages/shared

WORKDIR /repo/apps/api

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --retries=5 \
  CMD node -e "require('http').get('http://localhost:3000/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

CMD ["npm", "run", "dev"]

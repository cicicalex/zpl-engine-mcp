# Glama MCP introspection runtime.
#
# Why this Dockerfile exists: Glama's auto-discovery requires a Dockerfile so it
# can boot the server in a sandbox and call `tools/list` to count + describe
# our tools without anyone running `npm install` on their box.
#
# The actual production install path is `npx zpl-engine-mcp setup` — this
# Dockerfile is NOT how end users run the server. It is purely an introspection
# stub for the Glama directory.
#
# Server boots cleanly without ZPL_API_KEY (see src/index.ts: "API key check
# moved to main() — allows Smithery sandbox scanning without key"), so Glama
# can introspect even with no credentials present.

FROM node:20-alpine

WORKDIR /app

# Copy manifest first for better layer caching when only source changes.
COPY package.json package-lock.json ./

# --omit=dev: we ship the prebuilt dist/ — no TS toolchain needed at runtime.
# --no-audit / --no-fund: shave noise off the build log.
RUN npm ci --omit=dev --no-audit --no-fund

# dist/ is built by `npm run build` and committed to the npm tarball already.
# We copy it directly rather than rebuilding so the Docker image matches
# exactly what `npm install` would give a user.
COPY dist ./dist

# Optional helpers — small enough to include for parity with the npm package.
COPY README.md LICENSE ./

ENV NODE_ENV=production

# stdio MCP server reads JSON-RPC from stdin, writes to stdout.
# Glama wires its own stdio when introspecting; no port exposure needed.
CMD ["node", "dist/index.js"]

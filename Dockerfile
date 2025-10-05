## Multi-stage Dockerfile for geo-sparkle-react-06277
# Build stage: install node deps and build frontend
FROM node:18-slim AS build
WORKDIR /app

# Install build tools
RUN apt-get update && apt-get install -y ca-certificates curl build-essential python3-minimal --no-install-recommends && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --silent

# Copy app sources and build
COPY . .
RUN npm run build

# Runtime stage: node + python to run server.js and optional python scripts
FROM node:18-slim
WORKDIR /app

# Install python3 and pip
RUN apt-get update && apt-get install -y python3 python3-venv python3-pip ca-certificates --no-install-recommends && rm -rf /var/lib/apt/lists/*

# Copy built frontend and server files
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./
COPY --from=build /app/package.json ./
COPY --from=build /app/package-lock.json ./
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/requirements.txt ./requirements.txt

# Install production node deps
RUN npm ci --only=production --silent || true

# Install Python requirements if present
RUN if [ -f requirements.txt ]; then \
			python3 -m venv /opt/venv && \
			/opt/venv/bin/pip install --upgrade pip setuptools wheel && \
			/opt/venv/bin/pip install --no-cache-dir -r requirements.txt || true; \
		fi

ENV NODE_ENV=production
ENV PATH="/opt/venv/bin:$PATH"
EXPOSE 3000

# Start the Node server which serves the built frontend and API
CMD ["node", "server.js"]

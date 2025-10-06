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
FROM node:18-slim AS runtime
WORKDIR /app

# Install runtime dependencies (python for forecasting)
RUN apt-get update \
		&& apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
		&& rm -rf /var/lib/apt/lists/*

# Create a non-root user for running the app
RUN addgroup --system app && adduser --system --ingroup app app

# Copy only necessary artifacts from build stage
COPY --from=build /app/dist ./dist
COPY --from=build /app/server.js ./server.js
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/package-lock.json ./package-lock.json
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/requirements.txt ./requirements.txt

# Install production node dependencies exactly from lockfile
RUN npm ci --only=production --silent

# Install Python requirements into a venv (if present)
RUN if [ -f requirements.txt ]; then \
			python3 -m venv /opt/venv && \
			/opt/venv/bin/pip install --upgrade pip setuptools wheel && \
			/opt/venv/bin/pip install --no-cache-dir -r requirements.txt ; \
		fi

# Ensure application files are owned by non-root user
RUN chown -R app:app /app /opt/venv || true

ENV NODE_ENV=production
ENV PATH="/opt/venv/bin:$PATH"
USER app
EXPOSE 3000

# Healthcheck to allow orchestrators to know when app is ready
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
	CMD curl -f http://127.0.0.1:3000/health || exit 1

# Start the Node server which serves the built frontend and API
CMD ["node", "server.js"]

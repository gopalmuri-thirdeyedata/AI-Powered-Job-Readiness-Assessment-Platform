# ==============================================================================
# HIRINGAI / PREPWIN UNIFIED FULL-STACK DOCKERFILE
# ==============================================================================

# ------------------------------------------------------------------------------
# Stage 1: Build React Frontend (Vite Single Page Application)
# ------------------------------------------------------------------------------
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Copy package manifests first for efficient Docker layer caching
COPY frontend/package*.json ./
RUN npm ci --legacy-peer-deps

# Copy frontend source files
COPY frontend/ ./

# Build arguments for frontend environment variables
ARG VITE_API_URL=/api
ARG VITE_CLERK_PUBLISHABLE_KEY=pk_test_dWx0aW1hdGUtZmVycmV0LTYzLmNsZXJrLmFjY291bnRzLmRldiQ
ARG VITE_VAPI_PUBLIC_KEY=85876843-8675-47b9-b5bd-f4387a97473d

ENV VITE_API_URL=$VITE_API_URL \
    VITE_CLERK_PUBLISHABLE_KEY=$VITE_CLERK_PUBLISHABLE_KEY \
    VITE_VAPI_PUBLIC_KEY=$VITE_VAPI_PUBLIC_KEY

# Compile optimized static bundle to /app/frontend/dist
RUN npm run build

# ------------------------------------------------------------------------------
# Stage 2: Unified Production Runtime (Python 3.11 + Embedded Nginx)
# ------------------------------------------------------------------------------
FROM python:3.11-slim AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEBIAN_FRONTEND=noninteractive

WORKDIR /app

# Install system dependencies required for OpenCV, YOLO proctoring, curl, and Nginx
RUN apt-get update && apt-get install -y --no-install-recommends \
    nginx \
    curl \
    libgl1 \
    libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

# Install backend dependencies
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application source code
COPY backend/ /app/

# Copy compiled frontend assets from builder stage
COPY --from=frontend-builder /app/frontend/dist /var/www/html/

# Copy Nginx configuration and entrypoint script
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# Remove default nginx site if present
RUN rm -f /etc/nginx/sites-enabled/default 2>/dev/null || true

# Ensure media storage directories exist
RUN mkdir -p /app/media/resumes /app/media/student_resumes /app/media/roleready

# Expose HTTP port 80 (and optional direct API port 8000)
EXPOSE 80 8000

# Health check probe against liveness endpoint via Nginx
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -f http://localhost/health/live || exit 1

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]

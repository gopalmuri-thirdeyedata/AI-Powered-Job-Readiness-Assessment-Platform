# ==============================================================================
# HIRINGAI FRONTEND DOCKERFILE (MULTI-STAGE BUILD)
# ==============================================================================

# Stage 1: Build production bundle
FROM node:20-alpine AS builder

WORKDIR /app

# Copy dependency manifests
COPY package*.json ./

# Install clean production dependencies (npm's download cache is kept between builds)
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund --legacy-peer-deps

# Copy application source code
COPY . .

# Build arguments for Vite environment variables
ARG VITE_API_URL

ENV VITE_API_URL=$VITE_API_URL

# Build production assets. Permissions are fixed here, on the small dist/ folder, so the final image does not need a second copy
# of every file in a chmod layer. Files created on Windows can otherwise end up unreadable by nginx (403 on logo_main.png).
RUN npm run build && chmod -R a+rX dist

# Stage 2: Serve with lightweight Nginx
FROM nginx:alpine

# Remove default nginx static assets
RUN rm -rf /usr/share/nginx/html/*

# Copy build artifacts from builder stage (modes are preserved)
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy custom Nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose HTTP port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
    CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]

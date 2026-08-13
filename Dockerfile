# Use official lightweight Node.js LTS image
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install dependencies first for better Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose standard port 3000 (Coolify / Docker default)
EXPOSE 3000

# Robust Node-based healthcheck (works across IPv4/IPv6, handles dynamic PORT, no wget/curl dependency)
HEALTHCHECK --interval=20s --timeout=5s --start-period=5s --retries=3 \
  CMD node -e "const http = require('http'); const port = process.env.PORT || 3000; http.get('http://127.0.0.1:' + port + '/api/status', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"

# Environment Defaults
ENV NODE_ENV=production \
    PORT=3000

# Start application
CMD ["npm", "start"]

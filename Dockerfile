# Use official lightweight Node.js LTS image
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install dependencies first for better Docker layer caching
COPY package*.json ./
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose server port
EXPOSE 3001

# Healthcheck
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3001/api/status || exit 1

# Environment Defaults
ENV NODE_ENV=production \
    PORT=3001

# Start application
CMD ["npm", "start"]

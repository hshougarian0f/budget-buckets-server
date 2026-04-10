FROM node:20-alpine
WORKDIR /app
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
COPY package*.json ./
RUN npm install --omit=dev
COPY --chown=nodejs:nodejs . .
USER nodejs
EXPOSE 8080
CMD ["node", "src/index.js"]

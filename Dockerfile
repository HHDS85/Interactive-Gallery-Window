FROM node:20-alpine

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# BASE_URL must be set to the public https URL so QR codes resolve publicly.
EXPOSE 4680
CMD ["node", "server/index.js"]

# Multi-stage Dockerfile para DomoEstoque
FROM node:22-alpine AS builder

WORKDIR /app

# Copia arquivos do backend
COPY backend/package*.json ./
RUN npm install

COPY backend/tsconfig.json ./
COPY backend/src ./src
COPY backend/public ./public

# Compila o TypeScript do backend
RUN npm run build

# Estágio de Produção
FROM node:22-alpine AS runner

WORKDIR /app

# Instala ferramentas necessárias para compilação nativa em Alpine se necessário
RUN apk add --no-cache python3 make g++

COPY backend/package*.json ./
RUN npm install --omit=dev

# Copia build compilado e pasta public
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Diretório persistente para o banco de dados SQLite
ENV DATA_DIR=/app/data
ENV PORT=3000
ENV NODE_ENV=production

RUN mkdir -p /app/data

EXPOSE 3000

CMD ["node", "dist/index.js"]

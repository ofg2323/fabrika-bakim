# Fabrika Bakım Yönetimi — üretim imajı
# Build context: depo kökü (docker-compose.yml ile otomatik)
#   docker build -f backend/Dockerfile -t fabrika-bakim .

FROM node:20-alpine

ENV NODE_ENV=production
WORKDIR /app

# Bağımlılıklar (package-lock.json ile deterministik kurulum)
COPY backend/package.json backend/package-lock.json ./backend/
RUN cd backend && npm ci --omit=dev

# Backend kaynakları
COPY backend/src ./backend/src
COPY backend/scripts ./backend/scripts

# Frontend dosyaları (server.js bunları depo kökünden sunar)
COPY fabrika-bakim.html api-client.js cmms-sync.js table-sort.js sw.js manifest.json ./

# PWA ikonları depoda tutulmuyor; imaj içinde üret
RUN node backend/scripts/generate-icon.js

# Yükleme klasörü ve çalışma izinleri
RUN mkdir -p backend/uploads && chown -R node:node /app
USER node

WORKDIR /app/backend
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3001/api/health || exit 1

# Önce bekleyen migration'ları uygula, sonra sunucuyu başlat.
# Migration'lar idempotenttir ve advisory lock ile korunur.
CMD ["sh", "-c", "node src/db/migrate.js && node src/server.js"]

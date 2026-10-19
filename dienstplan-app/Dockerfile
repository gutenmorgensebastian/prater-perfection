FROM node:22-slim
ENV NODE_ENV=production NODE_NO_WARNINGS=1 DATA_DIR=/data PORT=3000
WORKDIR /app
# Texterkennung für Pläne ohne lesbare Textebene (Bild-Scans, „Microsoft Print to PDF“)
RUN apt-get update && apt-get install -y --no-install-recommends poppler-utils tesseract-ocr tesseract-ocr-deu \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
VOLUME /data
EXPOSE 3000
CMD ["node", "server.js"]

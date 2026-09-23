# ==============================================================================
# Dockerfile - Plex WhatsApp Bot
# Multi-platform production image for Node.js 22 (Debian Bookworm Slim)
# ==============================================================================

FROM node:22-bookworm-slim

# Metadatos de la imagen
LABEL maintainer="Plex WhatsApp Bot"
LABEL description="Bot de WhatsApp para solicitar contenido en Plex, Radarr, Sonarr y avisos automáticos"

# Instalar dependencias básicas del sistema (curl para HEALTHCHECK, ca-certificates para TLS seguro)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

# Definir variables de entorno de producción
ENV NODE_ENV=production \
    PORT=3001 \
    BOT_LANGUAGE=es

# Crear y establecer directorio de trabajo
WORKDIR /app

# Copiar manifiestos de dependencias primero para optimizar la caché de capas
COPY package*.json ./

# Instalar exclusivamente dependencias de producción
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Copiar el código fuente de la aplicación
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

# Crear carpeta de datos persistentes con permisos adecuados
RUN mkdir -p /app/data && chown -R node:node /app

# Exponer el puerto del servidor HTTP (Webhooks, REST API y Dashboard Web)
EXPOSE 3001

# Definir volumen para persistencia de credenciales de WhatsApp y bases de datos JSON
VOLUME ["/app/data"]

# Comprobación de salud del contenedor
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://localhost:3001/api/status || exit 1

# Cambiar al usuario sin privilegios 'node' por seguridad
USER node

# Comando de inicio
CMD ["node", "src/index.js"]

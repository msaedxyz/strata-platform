# syntax=docker/dockerfile:1.7
# Image for the Python services: api, worker, migrate and the fixture server.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PROJECT_ENVIRONMENT=/opt/venv
WORKDIR /app

# Optional extra CA certificate for build networks that intercept TLS. A normal build does not need it.
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then cp /run/secrets/extra_ca /usr/local/share/ca-certificates/extra-ca.crt && \
      cat /run/secrets/extra_ca >> /etc/ssl/certs/ca-certificates.crt; fi

# Tesseract OCR for scanned PDF pages. If the package mirror is not reachable, the OCR fallback
# (RapidOCR from PyPI) runs instead. See docs/decisions.md.
RUN (apt-get update && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng && rm -rf /var/lib/apt/lists/*) \
    || echo "tesseract-ocr not installed: the OCR fallback is used"

RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export PIP_CERT=/etc/ssl/certs/ca-certificates.crt SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt; fi; \
    pip install --no-cache-dir uv==0.8.*

COPY pyproject.toml uv.lock README.md ./
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt; fi; \
    uv sync --frozen --no-dev --no-install-project --extra ocr-fallback

COPY services ./services
COPY config ./config
COPY prompts ./prompts
COPY db ./db
COPY data ./data
COPY tests/fixtures ./tests/fixtures
COPY scripts ./scripts
RUN --mount=type=secret,id=extra_ca,required=false \
    if [ -s /run/secrets/extra_ca ]; then export SSL_CERT_FILE=/etc/ssl/certs/ca-certificates.crt; fi; \
    uv sync --frozen --no-dev --extra ocr-fallback
ENV PATH="/opt/venv/bin:$PATH"
RUN useradd --system --uid 10001 strata && mkdir -p /data/objects && chown -R strata /data
USER strata
EXPOSE 8000
CMD ["uvicorn", "services.api.main:app", "--host", "0.0.0.0", "--port", "8000"]

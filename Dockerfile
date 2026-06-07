FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1
ENV HOST=0.0.0.0
ENV PORT=8000

WORKDIR /app

RUN addgroup --system app && adduser --system --ingroup app app

COPY app.py README.md PRD.md ./
COPY static ./static

RUN mkdir -p /app/data && chown -R app:app /app

USER app

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://127.0.0.1:%s/api/me' % os.environ.get('PORT', '8000'), timeout=3).read()"

CMD ["python", "app.py"]

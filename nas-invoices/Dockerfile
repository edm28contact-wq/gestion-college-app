FROM python:3.12.8-slim-bookworm
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app
COPY agent.py /app/agent.py
USER 10001:10001
CMD ["python", "-u", "/app/agent.py"]

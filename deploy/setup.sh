#!/bin/bash
set -e

echo "=== DD-Analyst Server Setup ==="
echo ""

# Check for .env file
if [ ! -f .env ]; then
    echo "Creating .env from .env.example..."
    cp .env.example .env
    # Generate a random JWT secret
    JWT_SECRET=$(openssl rand -hex 32)
    if [ "$(uname)" = "Darwin" ]; then
        sed -i '' "s/generate-a-random-64-char-string-here/$JWT_SECRET/" .env
    else
        sed -i "s/generate-a-random-64-char-string-here/$JWT_SECRET/" .env
    fi
    echo "Generated JWT secret. Edit .env to set POSTGRES_PASSWORD."
fi

echo "Starting services..."
docker compose up -d

# Wait for postgres
echo "Waiting for PostgreSQL..."
until docker compose exec -T postgres pg_isready -U ddanalyst > /dev/null 2>&1; do
    sleep 2
done
echo "PostgreSQL ready."

# Wait for ollama
echo "Waiting for Ollama..."
until curl -s http://localhost:11434/api/tags > /dev/null 2>&1; do
    sleep 2
done
echo "Ollama ready."

# Pull model
echo ""
echo "Pulling Llama 4 Scout model (this may take a while)..."
docker compose exec ollama ollama pull llama4:scout

echo ""
echo "=== DD-Analyst Server Ready ==="
echo ""
echo "Backend API:    http://localhost:8000"
echo "Health check:   http://localhost:8000/health"
echo "Default admin:  admin@ddanalyst.local / admin"
echo ""
echo "IMPORTANT: Change the admin password after first login."
echo ""

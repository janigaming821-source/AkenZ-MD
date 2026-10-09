#!/bin/bash
set -euo pipefail

echo "=== NOAURA BOT — Server Setup ==="
echo "This script sets up a fresh Ubuntu/Debian VM for the bot."
echo ""

# Install Node.js 22
if ! command -v node &>/dev/null; then
  echo "Installing Node.js 22..."
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
else
  echo "Node.js $(node -v) already installed."
fi

# Install system dependencies
echo "Installing system dependencies..."
sudo apt-get update
sudo apt-get install -y ffmpeg yt-dlp

# Create app user
if ! id -u noaura &>/dev/null; then
  sudo useradd -r -m -s /bin/bash noaura
  echo "Created 'noaura' user."
fi

# Create app directory
sudo mkdir -p /opt/noaura
sudo chown noaura:noaura /opt/noaura

# Install pm2 globally for process management
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
  echo "Installed pm2."
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Copy the project files to /opt/noaura (scp, rsync, or git clone)"
echo "2. cd /opt/noaura && npm ci --omit=dev && npx prisma generate"
echo "3. Create /opt/noaura/.env with your config"
echo "4. sudo chown -R noaura:noaura /opt/noaura"
echo "5. sudo -u noaura pm2 start dist/index.js --name noaura"
echo "6. sudo -u noaura pm2 save"
echo "7. pm2 startup (follow the output to auto-start on boot)"
echo ""
echo "The dashboard will be on port 3000. Use a reverse proxy (nginx/caddy) for HTTPS."

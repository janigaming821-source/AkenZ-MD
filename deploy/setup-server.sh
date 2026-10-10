#!/bin/bash
set -euo pipefail

echo "=== AkenZ MD — Server Setup ==="
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
if ! id -u akenz &>/dev/null; then
  sudo useradd -r -m -s /bin/bash akenz
  echo "Created 'akenz' user."
fi

# Create app directory
sudo mkdir -p /opt/akenz
sudo chown akenz:akenz /opt/akenz

# Install pm2 globally for process management
if ! command -v pm2 &>/dev/null; then
  sudo npm install -g pm2
  echo "Installed pm2."
fi

echo ""
echo "=== Setup complete ==="
echo ""
echo "Next steps:"
echo "1. Copy the project files to /opt/akenz (scp, rsync, or git clone)"
echo "2. cd /opt/akenz && npm ci --omit=dev && npx prisma generate"
echo "3. Create /opt/akenz/.env with your config"
echo "4. sudo chown -R akenz:akenz /opt/akenz"
echo "5. sudo -u akenz pm2 start dist/index.js --name akenz"
echo "6. sudo -u akenz pm2 save"
echo "7. pm2 startup (follow the output to auto-start on boot)"
echo ""
echo "The dashboard will be on port 3000. Use a reverse proxy (nginx/caddy) for HTTPS."

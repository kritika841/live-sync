#!/bin/bash
set -e
cd /home/deployer/apps/satmi-orders

echo "Backing up previous static chunks for zero-downtime client compatibility..."
mkdir -p /home/deployer/static-cache-orders
if [ -d ".next/static" ]; then
  cp -rn .next/static/* /home/deployer/static-cache-orders/ 2>/dev/null || true
fi

echo "Extracting new build..."
tar -xzf release.tar.gz
rm release.tar.gz

echo "Restoring previous static chunks..."
if [ -d "/home/deployer/static-cache-orders" ]; then
  cp -rn /home/deployer/static-cache-orders/* .next/static/ 2>/dev/null || true
  find /home/deployer/static-cache-orders -type f -mtime +7 -delete 2>/dev/null || true
fi

echo "Installing production dependencies..."
npm ci --omit=dev

echo "Reloading PM2 processes..."
pm2 startOrReload ecosystem.config.cjs --update-env
pm2 describe satmi-orders >/dev/null 2>&1 || (echo "satmi-orders PM2 process is missing" && exit 1)
pm2 save
sleep 3

echo "Running local health check..."
curl -f http://localhost:5001/auth/sign-in > /dev/null || (echo "Health check failed!" && exit 1)
echo "Deploy complete: $(date)"

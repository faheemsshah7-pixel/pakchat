#!/bin/sh
# setup.sh: makes a fresh Oracle Ubuntu server ready for PakChat. Run once, from deploy/:
#   sudo ./setup.sh
# It installs Docker, turns on automatic security updates (with a quiet restart at
# 4:30 am Pakistan time when one needs it), adds swap on small machines, opens the
# ports PakChat uses in the server's own firewall, makes the secrets in .env, and
# adds the nightly backup. Oracle's own firewall (the subnet's security list) is
# opened separately, in Oracle's website (README.md, step 4).
set -eu
cd "$(dirname "$0")"
[ "$(id -u)" = 0 ] || { echo "Run it with sudo: sudo ./setup.sh"; exit 1; }
owner="${SUDO_USER:-ubuntu}"

echo "1/6 Updates and Docker"
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get -y upgrade
apt-get install -y docker.io docker-compose-v2 unattended-upgrades iptables-persistent openssl git rsync
systemctl enable --now docker
usermod -aG docker "$owner"

echo "2/6 Automatic security updates"
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
CONF
cat > /etc/apt/apt.conf.d/52pakchat-upgrades <<'CONF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "23:30";
CONF
# (23:30 UTC is 4:30 am in Pakistan. PakChat starts again by itself after.)

echo "3/6 Swap (small machines)"
if [ "$(awk '/MemTotal/ {print $2}' /proc/meminfo)" -lt 3000000 ] && ! swapon --show | grep -q .; then
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "4/6 The server's own firewall"
# Oracle's Ubuntu turns away everything but SSH; let the website and the call relay in.
open() { iptables -C INPUT "$@" -j ACCEPT 2>/dev/null || iptables -I INPUT 1 "$@" -j ACCEPT; }
open -p tcp --dport 80
open -p tcp --dport 443
open -p udp --dport 443
open -p tcp --dport 3478
open -p udp --dport 3478
open -p udp --dport 49160:49200
netfilter-persistent save

echo "5/6 Secrets"
[ -f .env ] || cp .env.example .env
fill() { grep -q "^$1=." .env || sed -i "s|^$1=.*|$1=$(openssl rand -hex 32)|" .env; }
fill DB_PASSWORD
fill SECRET_KEY_BASE
fill TURN_SECRET
chmod 600 .env
mkdir -p secrets backups site
chown -R "$owner" .

echo "6/6 Nightly backup"
line="15 22 * * * $(pwd)/backup.sh >> $(pwd)/backups/backup.log 2>&1"
( crontab -u "$owner" -l 2>/dev/null | grep -v 'backup.sh' ; echo "$line" ) | crontab -u "$owner" -

echo "Done. Now fill in PAKCHAT_DOMAIN, PUBLIC_IP, PRIVATE_IP and the other lines in deploy/.env (README.md, step 6)."

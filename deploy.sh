#!/usr/bin/env bash
# Deploy the screensaver to a Debian-ish box (Raspberry Pi OS, Ubuntu) behind
# nginx, with TLS, because the audio capture APIs the spectrum analyser needs
# only exist on a secure origin.
set -euo pipefail

ROOT=/var/www/screensaver
SITE=screensaver
CERT_DIR=/etc/ssl/screensaver
HOSTNAME_="$(hostname)"
TLS=1
KIOSK=0
PUBLIC_HOST=""

usage() {
  cat <<EOF
usage: sudo ./deploy.sh [options]

  --root DIR      where the files are served from   (default: $ROOT)
  --host NAME     name to put in the certificate    (default: $HOSTNAME_)
  --no-tls        plain http only; audio will not work off localhost
  --kiosk         also autostart Chromium fullscreen on this machine
  --public FQDN   serve the internet through a Cloudflare tunnel: nginx is
                  bound to loopback only and no port is opened on the router
  -h, --help
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --root)   ROOT="$2"; shift 2 ;;
    --host)   HOSTNAME_="$2"; shift 2 ;;
    --no-tls) TLS=0; shift ;;
    --kiosk)  KIOSK=1; shift ;;
    --public) PUBLIC_HOST="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

[[ $EUID -eq 0 ]] || { echo "run me with sudo" >&2; exit 1; }

# Cloudflare terminates TLS at its edge and reaches nginx over loopback, where
# a certificate buys nothing and a self-signed one only gets in the way
if [[ -n "$PUBLIC_HOST" ]]; then TLS=0; fi

SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for f in index.html main.js styles.css; do
  [[ -f "$SRC/$f" ]] || { echo "missing $f in $SRC" >&2; exit 1; }
done

echo "==> installing nginx"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq nginx openssl

echo "==> copying files to $ROOT"
install -d -m 755 "$ROOT"
install -m 644 "$SRC"/index.html "$SRC"/main.js "$SRC"/styles.css "$ROOT/"

TLS_BLOCK=""
if [[ $TLS -eq 1 ]]; then
  IP="$(hostname -I | awk '{print $1}')"
  SAN="DNS:localhost,DNS:$HOSTNAME_,DNS:$HOSTNAME_.local,IP:127.0.0.1"
  [[ -n "$IP" ]] && SAN="$SAN,IP:$IP"

  if [[ ! -f "$CERT_DIR/cert.pem" ]]; then
    echo "==> generating a self-signed certificate for $SAN"
    install -d -m 700 "$CERT_DIR"
    openssl req -x509 -newkey rsa:2048 -nodes -days 3650 \
      -subj "/CN=$HOSTNAME_" -addext "subjectAltName=$SAN" \
      -keyout "$CERT_DIR/key.pem" -out "$CERT_DIR/cert.pem" 2>/dev/null
    chmod 600 "$CERT_DIR/key.pem"
  else
    echo "==> reusing the certificate already in $CERT_DIR"
  fi

  LISTEN=$'    listen 443 ssl default_server;\n    listen [::]:443 ssl default_server;\n    http2 on;'
  TLS_BLOCK="    ssl_certificate     $CERT_DIR/cert.pem;
    ssl_certificate_key $CERT_DIR/key.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    add_header Strict-Transport-Security \"max-age=31536000\" always;
"
elif [[ -n "$PUBLIC_HOST" ]]; then
  LISTEN=$'    listen 127.0.0.1:80 default_server;\n    listen [::1]:80 default_server;'
else
  LISTEN=$'    listen 80 default_server;\n    listen [::]:80 default_server;'
fi

echo "==> writing the nginx site"
{
  if [[ $TLS -eq 1 ]]; then
    cat <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    return 301 https://\$host\$request_uri;
}

EOF
  fi
  cat <<EOF
server {
$LISTEN

    root $ROOT;
    index index.html;

$TLS_BLOCK
    # a screensaver box is redeployed often; never let a stale main.js stick
    add_header Cache-Control "no-store" always;
    # the page loads nothing but its own two files and runs no inline script
    add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "no-referrer" always;
    add_header Permissions-Policy "display-capture=(self), microphone=(self), camera=(), geolocation=(), interest-cohort=()" always;

    server_tokens off;

    location / {
        try_files \$uri \$uri/ =404;
    }
}
EOF
} >/etc/nginx/sites-available/$SITE

ln -sf /etc/nginx/sites-available/$SITE /etc/nginx/sites-enabled/$SITE
rm -f /etc/nginx/sites-enabled/default

echo "==> reloading nginx"
nginx -t
systemctl enable --now nginx
systemctl reload nginx

if [[ -n "$PUBLIC_HOST" ]]; then
  echo "==> installing cloudflared"
  if ! command -v cloudflared >/dev/null; then
    install -d -m 755 /usr/share/keyrings
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
      >/usr/share/keyrings/cloudflare-main.gpg
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
      >/etc/apt/sources.list.d/cloudflared.list
    apt-get update -qq
    apt-get install -y -qq cloudflared
  fi

  install -d -m 755 /etc/cloudflared
  cat >/etc/cloudflared/config.yml <<EOF
# fill in the tunnel name and credentials file printed by
#   cloudflared tunnel create screensaver
tunnel: screensaver
credentials-file: /root/.cloudflared/CHANGEME.json

ingress:
  - hostname: $PUBLIC_HOST
    service: http://127.0.0.1:80
  - service: http_status:404
EOF
  chmod 600 /etc/cloudflared/config.yml

  cat <<EOF

==> nginx now answers on loopback only. Finish the tunnel by hand, because
    the login step needs a browser:

      cloudflared tunnel login
      cloudflared tunnel create screensaver
      sudo sed -i "s#CHANGEME#\$(ls -t ~/.cloudflared/*.json | head -1 | xargs -n1 basename | sed 's/.json//')#" /etc/cloudflared/config.yml
      cloudflared tunnel route dns screensaver $PUBLIC_HOST
      sudo cloudflared service install
      sudo systemctl enable --now cloudflared

    Do NOT forward port 80 or 443 on the router: the tunnel is outbound only.
EOF
fi

if [[ $KIOSK -eq 1 ]]; then
  USER_="${SUDO_USER:-$USER}"
  HOME_="$(getent passwd "$USER_" | cut -d: -f6)"
  BROWSER="$(command -v chromium-browser || command -v chromium || true)"
  if [[ -z "$BROWSER" ]]; then
    apt-get install -y -qq chromium-browser || apt-get install -y -qq chromium
    BROWSER="$(command -v chromium-browser || command -v chromium)"
  fi

  # localhost counts as a secure origin whatever the scheme, so the kiosk
  # gets working audio without ever meeting the self-signed cert warning
  KIOSK_URL="http://localhost/"
  KIOSK_FLAGS=""
  if [[ $TLS -eq 1 ]]; then
    KIOSK_URL="https://localhost/"
    # only tolerable because this browser talks to nothing but this machine
    KIOSK_FLAGS="--ignore-certificate-errors"
  fi

  install -d -m 755 -o "$USER_" -g "$USER_" "$HOME_/.config/autostart"
  cat >"$HOME_/.config/autostart/screensaver.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Screensaver
Exec=$BROWSER --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble $KIOSK_FLAGS --autoplay-policy=no-user-gesture-required --start-fullscreen $KIOSK_URL
X-GNOME-Autostart-enabled=true
EOF
  chown "$USER_:$USER_" "$HOME_/.config/autostart/screensaver.desktop"

  # stop X from blanking the panel the screensaver is meant to fill
  cat >"$HOME_/.config/autostart/no-blank.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Disable blanking
Exec=sh -c "xset s off; xset -dpms; xset s noblank"
X-GNOME-Autostart-enabled=true
EOF
  chown "$USER_:$USER_" "$HOME_/.config/autostart/no-blank.desktop"
  echo "==> kiosk autostart installed for $USER_ ($KIOSK_URL)"
fi

echo
echo "done."
if [[ -n "$PUBLIC_HOST" ]]; then
  echo "  local  : http://localhost/"
  echo "  public : https://$PUBLIC_HOST/   (once the tunnel is up)"
elif [[ $TLS -eq 1 ]]; then
  echo "  local : https://localhost/"
  echo "  lan   : https://$HOSTNAME_.local/   (self-signed: accept the warning once)"
else
  echo "  local : http://localhost/"
  echo "  lan   : http://$HOSTNAME_.local/    (no audio: not a secure origin)"
fi

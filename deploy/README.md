# PakChat on Oracle Cloud (Always Free)

Everything PakChat needs runs on one free Oracle server, in Docker:

| Part | What it is |
|---|---|
| `db` | Postgres, the database |
| `app` | the PakChat server (`../server`, built on the server from its `Dockerfile`) |
| `web` | Caddy: the website, `pakchat.apk`, free HTTPS (Let's Encrypt), and the doors to the server |
| `turn` | coturn, the call relay for networks where phones can't reach each other |

Nothing here costs money. Never press "Upgrade to Pay As You Go" in Oracle's website.

## 1. The account (the owner)
Oracle Cloud sign-up, home region **India West (Mumbai)**. A card is checked with a small hold
that's given back. If the card is refused: turn on international and online payments in the
bank's app, use the card's own billing address, turn off any VPN, and use a normal bank card
(not a virtual or prepaid one).

## 2. The server
Compute › Instances › Create instance:
- Image: **Canonical Ubuntu 24.04**.
- Shape: **Ampere VM.Standard.A1.Flex**, 2 OCPUs and 12 GB (free). If Mumbai has no Ampere
  room, **VM.Standard.E2.1.Micro** (free, 1 GB) works too; `setup.sh` adds swap for it.
- Networking: a new public subnet, "Assign a public IPv4 address".
- SSH keys: upload the public key made on the Mac (`ssh-keygen -t ed25519`); the private key never leaves the Mac.

"Out of capacity" (Mumbai's free Ampere servers are all taken): let the Mac ask for one every
minute until it frees up, with `oracle-retry.sh`. It also makes the network and opens the ports
in step 4. Once:
1. `brew install oci-cli`
2. Oracle › Profile (top right) › My profile › API keys › Add API key › Generate API key pair ›
   Download private key › Add. Copy the "Configuration file preview" it shows, then:
   `mkdir -p ~/.oci && mv ~/Downloads/*.pem ~/.oci/oci_api_key.pem && pbpaste > ~/.oci/config && sed -i '' 's#^key_file=.*#key_file=~/.oci/oci_api_key.pem#' ~/.oci/config && oci setup repair-file-permissions --file ~/.oci/config && oci setup repair-file-permissions --file ~/.oci/oci_api_key.pem`
3. `cd deploy && caffeinate -i ./oracle-retry.sh` (Mac awake, lid open). It says when it has the server.

## 3. An address
Make a free name at duckdns.org (for example `pakchat.duckdns.org`) and point it at the
server's public IP. HTTPS needs a name; Caddy gets the certificate by itself.

## 4. Oracle's firewall
Networking › the server's subnet › Security list › Add ingress rules, source `0.0.0.0/0`:
TCP 80, TCP 443, UDP 443, TCP 3478, UDP 3478, UDP 49160-49200.

## 5. Set up
```sh
ssh ubuntu@<public ip>
git clone <the repo> pakchat   # or copy it over
cd pakchat/deploy && sudo ./setup.sh
```
Log out and in again (so `docker` works without sudo).

## 6. Settings
Edit `deploy/.env`: `PAKCHAT_DOMAIN`, `PUBLIC_IP`, `PRIVATE_IP` (both on the instance's page),
`GOOGLE_CLIENT_IDS`, and `KLIPY_KEY` if used. The secrets are already made. Put Firebase's
service account key at `deploy/secrets/firebase.json` (copied with `scp`, never pasted in chat).

## 7. Start
```sh
./build-site.sh                 # the website (add the APK: ./build-site.sh pakchat.apk 9 1.0.9)
docker compose up -d --build    # everything; starts again by itself after a restart
docker compose logs -f app      # watch it (Ctrl+C stops watching, not PakChat)
```
Check: `https://<domain>/api/health` says ok, and the website shows its QR code.

## 8. Backups
`setup.sh` adds `backup.sh` to run every night at 3:15 am (Pakistan), keeping 14 days in
`deploy/backups`: the database, and everyone's profile, group and community photos. It also
warns in its log when the disk has less than 5 GB free. (The server itself refuses new files
and chat backups before the disk gets that full: `MIN_FREE_MB`, 2 GB by default.) To also keep them off the server (free, Oracle Object Storage):
Storage › Buckets › Create `pakchat-backups`; Profile › Customer secret keys › Generate; then
write `deploy/secrets/rclone.conf`:
```ini
[oracle]
type = s3
provider = Other
access_key_id = <key>
secret_access_key = <secret>
endpoint = https://<namespace>.compat.objectstorage.ap-mumbai-1.oraclecloud.com
```
and add `BACKUP_BUCKET=pakchat-backups` to `.env`. To also keep people's chat backups there,
add `BACKUP_CHAT_BACKUPS=yes` (only changed ones are sent; the free storage is 20 GB, so
check the bucket's size now and then).

Restore (on a fresh server, after step 7):
```sh
docker compose exec -T db pg_restore -U pakchat -d pakchat --clean < backups/<file>.dump
docker compose exec -T app tar -C /data/files -xf - < backups/<photos file>.tar
```

## 9. WhatsApp number check
People prove their number by sending a short code to PakChat's WhatsApp number (free; see
`server/lib/pakchat/whatsapp.ex`). Once, in Meta's developer site (developers.facebook.com):
1. My Apps › Create app › "Other" › "Business", then add the **WhatsApp** product. Meta gives a
   free test number to start with; a real number (its own SIM, not on the WhatsApp app) comes later.
2. WhatsApp › Configuration › Webhook: callback URL `https://<domain>/api/whatsapp/webhook`,
   verify token: a long word you make up. Then subscribe to **messages**.
3. In `deploy/.env`: `WHATSAPP_NUMBER` (digits), `WHATSAPP_APP_SECRET` (App settings › Basic),
   `WHATSAPP_VERIFY_TOKEN` (the same made-up word), and for the "Done" reply `WHATSAPP_TOKEN`
   and `WHATSAPP_PHONE_NUMBER_ID` (WhatsApp › API Setup). Then `docker compose up -d`.

The app shows "Continue with WhatsApp" by itself once the server has these.

## Updating PakChat
```sh
git pull && docker compose up -d --build && ./build-site.sh
```
Security updates for Ubuntu install themselves; a restart, when one needs it, happens at 4:30 am.

## Good to know
- Oracle can take back a free server that sits idle (almost no CPU, network or memory use)
  for 7 days. A PakChat with people using it isn't idle; the backups cover the rest.
- Tested before the first deploy: the whole stack ran in Docker with the production build,
  the website's QR linking worked through Caddy, the call relay handed out relay addresses
  (and refused a wrong password), and a backup was made and read back.

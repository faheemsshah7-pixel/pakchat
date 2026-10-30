#!/bin/sh
# backup.sh: a copy of PakChat's database, made every night by cron (setup.sh adds it).
# Keeps the last 14 here in deploy/backups. With BACKUP_BUCKET set in .env (Oracle Object
# Storage, free up to 20 GB), each one is also copied off the server, so a lost server loses nothing.
# Messages are locked on the phones; the database holds accounts, chats and messages not yet delivered.
set -eu
cd "$(dirname "$0")"
mkdir -p backups
stamp="$(date -u +%Y-%m-%d-%H%M)"
name="backups/pakchat-$stamp.dump"
docker compose exec -T db pg_dump -U pakchat -Fc pakchat > "$name.part"
mv "$name.part" "$name"

# Profile, group and community photos live in the files folder, not the database: copy them too
# (they're small). Attachments aren't copied: they're gone after 30 days anyway.
photos="backups/pakchat-photos-$stamp.tar"
docker compose exec -T db psql -U pakchat -d pakchat -Atc "select id from files where kind = 'photo' and uploaded" > backups/.photo-ids
docker compose exec -T app tar -C /data/files -cf - --ignore-failed-read -T - < backups/.photo-ids > "$photos.part" 2>/dev/null || true
mv "$photos.part" "$photos"
rm -f backups/.photo-ids

ls -1t backups/pakchat-*.dump | tail -n +15 | xargs -r rm --
ls -1t backups/pakchat-photos-*.tar 2>/dev/null | tail -n +15 | xargs -r rm --
. ./.env
if [ -n "${BACKUP_BUCKET:-}" ]; then
  rclone() {
    docker run --rm -v "$PWD/backups:/backups:ro" -v "$PWD/secrets/rclone.conf:/config/rclone/rclone.conf:ro" \
      --volumes-from "$(docker compose ps -q app)" rclone/rclone:1.68 "$@"
  }
  rclone copy "/backups/$(basename "$name")" "oracle:$BACKUP_BUCKET/"
  rclone copy "/backups/$(basename "$photos")" "oracle:$BACKUP_BUCKET/"
  # People's chat backups too, when asked for (BACKUP_CHAT_BACKUPS=yes): only the ones that changed
  # are sent. Oracle's free storage is 20 GB, so watch the bucket's size as people join.
  if [ "${BACKUP_CHAT_BACKUPS:-}" = "yes" ]; then
    docker compose exec -T db psql -U pakchat -d pakchat -Atc "select id from files where kind = 'backup' and uploaded" > backups/.backup-ids
    rclone sync /data/files "oracle:$BACKUP_BUCKET/chat-backups/" --files-from-raw /backups/.backup-ids
    rm -f backups/.backup-ids
  fi
fi

# A warning in the log (and in cron's mail) when the disk is getting full.
free=$(df -Pk . | awk 'NR==2 {print $4}')
if [ "$free" -lt 5242880 ]; then echo "WARNING: less than 5 GB free on the server's disk"; fi
echo "Backed up to $name and $photos"

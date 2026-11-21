#!/bin/sh
# backup.sh: a copy of PakChat's database, made every night by cron (setup.sh adds it).
# Keeps the last 14 here in deploy/backups. With BACKUP_BUCKET set in .env (Oracle Object
# Storage, free up to 10 GB), each one is also copied off the server, so a lost server loses nothing.
# Copies sent there are locked first with age, to BACKUP_PUBLIC_KEY (its private half is kept off
# the server, README.md step 8), so the bucket's files are useless to anyone who gets them.
# Messages are locked on the phones; the database holds accounts, chats and messages not yet delivered.
set -eu
cd "$(dirname "$0")"
mkdir -p backups
rm -f backups/*.age backups/*.age.part  # left by a run that stopped half way
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
status=0
if [ -n "${BACKUP_BUCKET:-}" ]; then
  rclone() {
    docker run --rm -v "$PWD/backups:/backups:ro" -v "$PWD/secrets/rclone.conf:/config/rclone/rclone.conf:ro" \
      --volumes-from "$(docker compose ps -q app)" rclone/rclone:1.68 "$@"
  }
  # Never an unlocked copy off the server: without the key (or age), nothing is sent and the log says so.
  if [ -z "${BACKUP_PUBLIC_KEY:-}" ]; then
    echo "ERROR: BACKUP_PUBLIC_KEY isn't set in .env, so nothing was copied to the bucket (README.md, step 8)"
    status=1
  elif ! command -v age >/dev/null 2>&1; then
    echo "ERROR: age isn't installed (sudo apt-get install -y age), so nothing was copied to the bucket"
    status=1
  else
    for f in "$name" "$photos"; do
      age -r "$BACKUP_PUBLIC_KEY" -o "$f.age.part" "$f"
      mv "$f.age.part" "$f.age"
      rclone copy "/backups/$(basename "$f").age" "oracle:$BACKUP_BUCKET/"
      rm -f "$f.age"
    done
  fi
  # People's chat backups too, when asked for (BACKUP_CHAT_BACKUPS=yes): only the ones that changed
  # are sent. Those are already locked on each phone with its owner's backup password. Oracle's
  # free storage is 10 GB, so watch the bucket's size as people join.
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
exit "$status"

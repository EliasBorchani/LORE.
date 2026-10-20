# Deploying LORE. on a small VPS

One server runs everything with Docker Compose (`compose.prod.yaml`):

- **web** (Caddy): the only part reachable from outside, on ports 80 and 443. It gets and renews the HTTPS
  certificate by itself, serves the web app, and forwards `/api/*` to the server.
- **server** (Rust) and **postgres**: on Docker's internal network only.

Sheets are computed on each player's device, so the server needs little: 2 vCPU and 4 GB of RAM are plenty. The
4 GB are for building the images on the server (Rust and the Kotlin engine); running needs much less.

## 1. Create the server (OVHcloud VPS, about €5–7 a month)

1. On ovhcloud.com, order a **VPS**:
   - Model: the smallest (VPS-1, about 4 vCPU, 8 GB). Builds need about 4 GB; running needs much less.
   - Location: a data centre in France (Gravelines, Roubaix or Strasbourg).
   - Image: **Ubuntu 24.04**.
   - SSH key: paste your public key (`pbcopy < ~/.ssh/id_ed25519_perso.pub` on your Mac). No password login.
2. OVH emails you when the server is ready (a few minutes), with its **IPv4 address** (four numbers such as
   `51.75.12.34`). The user is `ubuntu`.

## 2. Point the domain to it (DuckDNS)

On duckdns.org, logged in: in the line of your subdomain, type the server's IPv4 address in "current ip" and click
"update ip". The address never changes, so this is done once (no update script needed).

Check from your Mac: `dig +short <your name>.duckdns.org` shows the server's address. Caddy can only get the HTTPS
certificate once it does.

## 3. Prepare the server

```sh
ssh -i ~/.ssh/id_ed25519_perso ubuntu@<server address>

# Security updates installed automatically, Docker from its official repository.
sudo apt update && sudo apt -y upgrade && sudo apt -y install unattended-upgrades rsync git ufw
curl -fsSL https://get.docker.com | sudo sh

# Firewall: SSH, HTTP and HTTPS (and HTTP/3) in, everything else blocked.
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw --force enable

# A user to run LORE., allowed to use Docker, reachable with the same SSH key.
sudo adduser --disabled-password --gecos "" lore
sudo usermod -aG docker lore
sudo mkdir -p /home/lore/.ssh && sudo cp ~/.ssh/authorized_keys /home/lore/.ssh/
sudo chown -R lore:lore /home/lore/.ssh
sudo mkdir -p /srv/lore && sudo chown lore:lore /srv/lore
```

Docker can open ports past `ufw`, but only Caddy publishes any (80 and 443, allowed anyway): the server and the
database stay unreachable from outside.

From now on, connect as `lore`: `ssh -i ~/.ssh/id_ed25519_perso lore@<server address>`.

## 4. Get the code (read-only deploy key)

The repository is private: the server gets its own key, allowed to read this repository only.

```sh
ssh-keygen -t ed25519 -N "" -C "lore-server" -f ~/.ssh/lore_deploy
cat ~/.ssh/lore_deploy.pub
```

On GitHub: the repository → Settings → Deploy keys → Add deploy key, paste it, leave "Allow write access" unchecked.

```sh
GIT_SSH_COMMAND="ssh -i ~/.ssh/lore_deploy -o IdentitiesOnly=yes" git clone git@github.com:EliasBorchani/LORE..git /srv/lore
cd /srv/lore
git config core.sshCommand "ssh -i ~/.ssh/lore_deploy -o IdentitiesOnly=yes"
```

## 5. Settings

```sh
cp .env.example .env
chmod 600 .env
nano .env
```

- `POSTGRES_PASSWORD`: a long random value (`openssl rand -base64 32`).
- `JWT_SECRET`: `openssl rand -base64 48`. Changing it later logs everyone out.
- `LORE_DOMAIN`: your address, for example `my-group.duckdns.org`.
- `DATABASE_URL`: not used in production (it is for tests on a development machine).
- `BACKUP_REMOTE`: see step 8.
- `SMTP_USER`, `SMTP_PASSWORD`: for invitation mails (step 7). `SMTP_USER` is your Gmail address. `SMTP_PASSWORD` is
  a Gmail **app password**, not your real password: on your Google account, turn on 2-step verification, then open
  myaccount.google.com/apppasswords, create one named "LORE.", and paste the 16 letters (spaces don't matter).
  Left empty, invitations print the link instead (`--no-email`).

## 6. Start

```sh
mkdir -p exports      # before the first start: else Docker creates it for root, and backups cannot write there
tmux new -s build     # the build goes on if the connection drops (back with: tmux attach -t build)
docker compose -f compose.prod.yaml up -d --build
```

The first build takes 10 to 20 minutes (Rust server, Kotlin engine, web app). Then:

```sh
docker compose -f compose.prod.yaml ps                       # three services "Up"
docker compose -f compose.prod.yaml logs web | grep -i certificate   # "certificate obtained successfully"
curl https://<your domain>/api/health                        # ok
```

Caddy limits each client address to 20 tries in 10 minutes on login and invitation links (`deploy/Caddyfile`); the
21st gets 429 for the rest of the window. Check once that Caddy sees the real addresses, from your Mac:

```sh
for i in $(seq 21); do curl -s -o /dev/null -w '%{http_code} ' -X POST https://<your domain>/api/auth/login; done
```

It prints 415 twenty times (the server refuses an empty request), then 429. Then log in from your phone on mobile data (another
address): it must still work. If the phone is blocked too, Caddy sees one address for everyone (Docker's) and the
limit would block the whole group: tell Claude.

## 7. Content and accounts

```sh
deploy/import-content.sh --dry-run    # what would be imported
deploy/import-content.sh              # the whole official catalog (about 1,430 entities)

docker compose -f compose.prod.yaml exec server server user add <your email> --role admin
docker compose -f compose.prod.yaml exec server server user invite <a player's email>   # each member
```

The email is the login. `user add` asks for the password twice (at least 12 characters). `user invite` mails a
link, valid 7 days and usable once, where the person chooses their password (with groups, members with « Inviter »
invite from the group's page instead; the server needs `APP_URL` and the SMTP settings for that). Inviting the same email again replaces
the link. Add `--role admin` for another admin, or `--no-email` to print the link and send it yourself. If the mail
cannot be sent, the command prints the link anyway.

An account created before invitations, with a login that is not an email:
`docker compose -f compose.prod.yaml exec server server user rename <old login> <email>`. Characters stay attached;
the edit history keeps the old name. `import-content.sh` is for the first import only:
it refuses a database that already has entities. A later batch is imported on its own:
`docker compose -f compose.prod.yaml exec server server import /content/srd/<file>.json --author srd-import --dry-run`,
then the same without `--dry-run`.

## 8. Backups

Characters, team content and accounts exist only in the database: back them up from day one.

```sh
crontab -e
# then add:
30 3 * * * /srv/lore/deploy/backup.sh >> /srv/lore/exports/backup.log 2>&1
```

Every night, `deploy/backup.sh` writes a full export (`exports/<date>/`, history included), keeps the 14 newest, and
copies them off the machine when `BACKUP_REMOTE` is set (any machine reachable with SSH and rsync: a storage box,
another server, a NAS at home). Give the `lore` user a key (`ssh-keygen -t ed25519`), allow it on that machine, and
set for example `BACKUP_REMOTE=user@backup-host:lore`. Until then, OVH's automated backup option keeps copies of the
whole disk.

Check once by hand: `deploy/backup.sh`, then `ls exports/`. If it cannot write, `exports/` belongs to root: as
`ubuntu`, `sudo chown lore:lore /srv/lore/exports`.

A copy on your own computer, now and then:
`rsync -a -e "ssh -i ~/.ssh/id_ed25519_perso" lore@<server address>:/srv/lore/exports/ ~/LORE-backups/`.

Restoring (a new server, or after a disaster): an empty database, then
`docker compose -f compose.prod.yaml exec server server restore /exports/<date>` (see `server/AGENTS.md`, Data safety).

## 9. Updating

```sh
cd /srv/lore
git pull
docker compose -f compose.prod.yaml up -d --build
```

Database migrations run by themselves when the server starts. Never `docker compose down -v`: `-v` deletes the
database.

### Once: groups and rulesets (M1, `docs/prd-multi.md`)

The update that brings groups adds tables by itself, then today's table moves into the first group with one command.
It renames team content (`feat.x` → `<slug>:feat.x`) for good, so export first:

```sh
docker compose -f compose.prod.yaml exec server server export /exports/before-groups
git pull && docker compose -f compose.prod.yaml up -d --build
docker compose -f compose.prod.yaml exec server server migrate-groups --owner <your email> \
  --group-name "<the table's name>" --ruleset <slug> --ruleset-name "<its name>" --dry-run
# read the id map it prints, then the same without --dry-run
```

Until it runs, nobody is in a group: the app shows no group. The owner becomes the only platform admin; today's
admins become admins of the group, the other accounts get « Voir les personnages » and « Modifier le contenu ». The
slug is the ruleset's id forever (3 to 31 lowercase letters, digits or `_`). Rollback: `restore` of
`before-groups` into an empty database. A later official import that names a team id brings the old id back (shown
as missing): such files must use the new id.

## Known limits

- The limit per address counts every try, right or wrong, and lives in Caddy's memory: a restart clears it. Caddy is
  built with the `caddy-ratelimit` plugin (`apps/web/Dockerfile`, Caddy and plugin versions pinned there); updating
  Caddy means changing both versions together.
- The core rule sections (statistics, bonus types, dice steps) come from `test-references/danalieth/catalog.json`.
  They should move to a batch of their own in `content/` so production does not depend on a test file.
- Images are built on the server. If that ever becomes too slow, GitHub Actions can build them instead.

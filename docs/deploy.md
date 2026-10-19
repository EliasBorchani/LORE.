# Deploying LORE. on a small VPS

One server runs everything with Docker Compose (`compose.prod.yaml`):

- **web** (Caddy): the only part reachable from outside, on ports 80 and 443. It gets and renews the HTTPS
  certificate by itself, serves the web app, and forwards `/api/*` to the server.
- **server** (Rust) and **postgres**: on Docker's internal network only.

Sheets are computed on each player's device, so the server needs little: 2 vCPU and 4 GB of RAM are plenty. The
4 GB are for building the images on the server (Rust and the Kotlin engine); running needs much less.

## 1. Create the server (Hetzner Cloud, about €5 a month)

1. In the Hetzner Cloud console, create a server:
   - Location: Falkenstein, Nuremberg or Helsinki (EU).
   - Image: Ubuntu 24.04.
   - Type: **CX22** (2 vCPU, 4 GB, x86) or **CAX11** (2 vCPU, 4 GB, ARM, a bit cheaper). Both work: the images are
     built on the server itself.
   - SSH key: paste your public key (`~/.ssh/id_ed25519_perso.pub`). No password login.
   - Backups: optional (+20 %), a daily copy of the whole disk, kept 7 days.
2. Create a firewall (Firewalls → Create) and apply it to the server. Inbound: TCP 22 (SSH), TCP 80, TCP 443, UDP 443
   (HTTP/3). Nothing else.
3. Note the server's IPv4 (and IPv6) address.

## 2. Point a domain to it

At your domain registrar (or DNS provider), add an `A` record `lore.your-domain.tld` → the IPv4 address, and an
`AAAA` record → the IPv6 address. Caddy can only get the certificate once this name resolves to the server
(`dig +short lore.your-domain.tld` shows the address).

## 3. Prepare the server

```sh
ssh -i ~/.ssh/id_ed25519_perso root@<server address>

# Security updates installed automatically, Docker from its official repository.
apt update && apt -y upgrade && apt -y install unattended-upgrades rsync git
curl -fsSL https://get.docker.com | sh

# A user to run LORE., allowed to use Docker.
adduser --disabled-password --gecos "" lore
usermod -aG docker lore
mkdir -p /home/lore/.ssh && cp ~/.ssh/authorized_keys /home/lore/.ssh/ && chown -R lore:lore /home/lore/.ssh
mkdir -p /srv/lore && chown lore:lore /srv/lore
```

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
- `LORE_DOMAIN`: `lore.your-domain.tld`.
- `DATABASE_URL`: not used in production (it is for tests on a development machine).
- `BACKUP_REMOTE`: see step 8.

## 6. Start

```sh
docker compose -f compose.prod.yaml up -d --build
```

The first build takes 10 to 20 minutes (Rust server, Kotlin engine, web app). Then:

```sh
docker compose -f compose.prod.yaml ps                       # three services "Up"
docker compose -f compose.prod.yaml logs web | grep -i certificate   # "certificate obtained successfully"
curl https://lore.your-domain.tld/api/health                 # ok
```

## 7. Content and accounts

```sh
deploy/import-content.sh --dry-run    # what would be imported
deploy/import-content.sh              # the whole official catalog (about 1,430 entities)

docker compose -f compose.prod.yaml exec server server user add <your login> --role admin
docker compose -f compose.prod.yaml exec server server user add <a player>          # each member
```

`user add` asks for the password twice (at least 12 characters). `import-content.sh` is for the first import only:
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
copies them off the machine when `BACKUP_REMOTE` is set. A cheap place for that copy: a Hetzner Storage Box (about
€3–4 a month for 1 TB). Give the `lore` user's key (`ssh-keygen -t ed25519`, then add it to the box) and set, for
example, `BACKUP_REMOTE=u123456@u123456.your-storagebox.de:lore` (the box's SSH port is 23: add
`Host u123456.your-storagebox.de` / `Port 23` to `~/.ssh/config`).

Check once by hand: `deploy/backup.sh`, then `ls exports/`.

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

## Known limits

- No limit on login attempts per address: the server limits failures per login only. Caddy has no rate limit
  built in; a plugin or fail2ban can come later.
- The core rule sections (statistics, bonus types, dice steps) come from `test-references/danalieth/catalog.json`.
  They should move to a batch of their own in `content/` so production does not depend on a test file.
- Images are built on the server. If that ever becomes too slow, GitHub Actions can build them instead.

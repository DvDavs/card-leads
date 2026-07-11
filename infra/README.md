# Infra — cards.kronet.app

Setup del droplet de pruebas (24.199.80.251, Ubuntu 24.04) que sirve las demos
publicadas por `pnpm cli deploy <slug>`. El droplet ya corre produccion de
KRONET (nginx en `kronet.app`, MySQL, Java:8080, Next:3210) — este setup solo
AGREGA un site block nuevo, nunca toca lo existente.

## Pasos (una sola vez)

1. **DNS** (manual, fuera de este repo): registro A `cards.kronet.app` →
   `24.199.80.251`, donde se administre el DNS de `kronet.app`. Sin esto el
   sitio solo responde por IP/Host header y certbot no puede emitir cert.

2. **SSH key dedicada** (local):
   ```
   ssh-keygen -t ed25519 -f ~/.ssh/cards_deploy -N ""
   ```
   Agregar la publica a `/root/.ssh/authorized_keys` del droplet (el deploy
   automatizado usa llave, nunca password). El primer login (sin la llave
   todavia instalada) se hace con password via `plink -hostkey <fingerprint>
   -batch -pw <password>` — no hay `sshpass` en Windows.

3. **Directorios en el droplet**:
   ```
   mkdir -p /var/www/cards/panelcards
   ```
   Subir `infra/panelcards/index.html` a `/var/www/cards/panelcards/index.html`.

4. **nginx**: copiar `infra/nginx/cards.kronet.app.conf` a
   `/etc/nginx/sites-available/cards.kronet.app`, symlink a `sites-enabled/`,
   correr `nginx -t` **antes** de `systemctl reload nginx`. Si `nginx -t`
   falla, NO recargar — el droplet sirve `kronet.app` en produccion.

5. **HTTPS**: cuando el DNS haya propagado (confirmar con `dig cards.kronet.app`),
   ```
   certbot --nginx -d cards.kronet.app
   ```
   Mientras el DNS no propague, el site queda funcionando por HTTP normal
   (probar con `curl -H "Host: cards.kronet.app" http://24.199.80.251/...`).

## Contrato del manifest del panel

`/var/www/cards/panelcards/leads.json` — array JSON top-level, un objeto por
lead publicado, ordenado por `deployed_at` descendente:

```json
[
  {
    "slug": "carlos-doc",
    "name": "Dr. Carlos ...",
    "rubro": "doctor",
    "dc_url": "https://cards.kronet.app/carlos-doc/dc/",
    "web_url": "https://cards.kronet.app/carlos-doc/web/",
    "deployed_at": "2026-07-10T12:00:00.000Z"
  }
]
```

Lo mantiene el stage `deploy` (`src/stages/deploy.ts`) — no se edita a mano.

## Privacidad

Solo se suben `dc/` y `web/` de cada lead. `data.json` y las fotos de tarjeta
(`card_front.jpg` / `card_back.jpg`) contienen datos personales y NUNCA salen
de la maquina local.

## Panel interno (mobile)

Panel web interno (`src/panel/`) que envuelve el pipeline CLI para operar un
lead desde el celular. Corre en el MISMO droplet que `cards.kronet.app` (mismo
box compartido con KRONET prod), pero aislado:

- **Nunca en el web root publico**: escucha en `127.0.0.1:4010` (loopback,
  nunca expuesto directo). nginx hace de reverse proxy en un subdominio
  APARTE, `panel.kronet.app` — nunca en el site de `cards.kronet.app`.
- **`LEADS_DIR` fuera de `/var/www/cards`**: `/srv/card-leads/leads`
  (`chmod 750`, dueno root). Fotos + `data.json` viven en el droplet pero
  jamas quedan dentro de un `root` de nginx — no son servibles publicamente
  bajo ninguna URL.
- **Auth**: passphrase compartida -> cookie de sesion firmada (HMAC), sobre
  HTTPS (`.env` -> `PANEL_PASSPHRASE`, `PANEL_SESSION_SECRET`).
- **Deploy-to-self**: el panel corre `enrich`/`build-cards`/`build-web` y
  despues `deploy`, que en este setup apunta a `DEPLOY_HOST=127.0.0.1` (scp a
  si mismo) para dejar `dc/`+`web/` en `/var/www/cards/<slug>/` exactamente
  igual que un deploy manual. Usa una llave DEDICADA solo para este loopback
  (`/root/.ssh/card_panel_selfdeploy`, generada en el propio droplet y
  agregada a su propio `authorized_keys`) — nunca la llave `cards_deploy` de
  la maquina local.

### Setup (una sola vez)

1. **DNS** (manual): registro A `panel.kronet.app` -> `24.199.80.251`, en el
   mismo lugar donde se administra `kronet.app`/`cards.kronet.app`.
2. **Node 22 + pnpm** en el droplet (`curl -fsSL
   https://deb.nodesource.com/setup_22.x | bash - && apt-get install -y
   nodejs`, luego `corepack prepare pnpm@<version-local> --activate` — usar
   la MISMA version mayor que genero el `pnpm-lock.yaml`, pnpm 9 no entiende
   la clave `allowBuilds` de `pnpm-workspace.yaml`).
3. **Codigo**: el working tree se empaqueta (`tar --exclude=node_modules
   --exclude=.git --exclude=leads --exclude=.env --exclude=.claude`) y se
   sube a `/opt/card-panel` — NO se clona del remoto de GitHub si hay cambios
   sin commitear. `pnpm install --frozen-lockfile` (valida que `sharp`/
   `colorthief` carguen: `node -e "require('sharp')"`).
4. **`.env`** en `/opt/card-panel/.env` (`chmod 600`): `GEMINI_API_KEY` +
   config de Gemini (copiada del `.env` local), `DEPLOY_HOST=127.0.0.1`,
   `DEPLOY_SSH_KEY=/root/.ssh/card_panel_selfdeploy`, `LEADS_DIR=/srv/card-leads/leads`,
   `PANEL_PASSPHRASE`/`PANEL_SESSION_SECRET` (generados nuevos para este
   deploy, nunca reusar secretos locales), `PANEL_PORT=4010`,
   `NODE_ENV=production` (activa cookie `Secure`, exige HTTPS).
5. **systemd**: copiar `infra/systemd/card-panel.service` a
   `/etc/systemd/system/`, `systemctl daemon-reload && systemctl enable --now
   card-panel`.
6. **nginx**: copiar `infra/nginx/panel.kronet.app.conf` a
   `/etc/nginx/sites-available/panel.kronet.app`, symlink a `sites-enabled/`,
   `nginx -t` **antes** de `systemctl reload nginx` (mismo criterio que
   `cards.kronet.app`: si falla, NO recargar).
7. **HTTPS**: `certbot --nginx -d panel.kronet.app` una vez que el DNS
   propague. Hasta entonces el login no funciona sobre HTTP publico (la
   cookie de sesion es `Secure` en produccion) — se puede probar la salud del
   servicio con `curl http://127.0.0.1:4010/api/health` directo en el
   droplet mientras tanto.

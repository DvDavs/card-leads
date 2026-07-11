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

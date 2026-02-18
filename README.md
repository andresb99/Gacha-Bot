# Gacha Anime Bot (Node.js + Discord + Firebase)

Bot de gachapon estilo anime para Discord con:
- tablero rotativo de personajes (default cada 1 hora)
- tiradas limitadas por dia
- probabilidades ajustadas por popularidad
- catalogo de personajes desde AniList
- persistencia en Firebase Firestore
- vista tipo card con embed + imagen del personaje

## Arquitectura modular

- `src/index.js`: arranque del bot e inyeccion de dependencias.
- `src/config.js`: configuracion global desde `.env`.
- `src/storage/store.js`: capa de persistencia (Firestore).
- `src/services/jikanClient.js`: cliente Jikan (imagenes/galeria de personaje).
- `src/services/anilistClient.js`: cliente AniList (catalogo + busqueda + imagenes).
- `src/services/characterCatalog.js`: catalogo de personajes (AniList) + agregacion de imagenes.
- `src/gacha/engine.js`: dominio gacha (pool, rareza, tablero, tiradas).
- `src/presentation/embeds.js`: construccion de cards/embeds.
- `src/presentation/imageCarousel.js`: carrusel reutilizable para vistas con imagen.
- `src/presentation/boardCarousel.js`: carrusel del tablero diario.
- `src/presentation/boardListPagination.js`: paginacion por paginas para `list`.
- `src/presentation/characterCarousel.js`: galeria de imagenes para `character`.
- `src/presentation/inventoryCarousel.js`: carrusel del inventario.
- `src/presentation/tradeOfferCard.js`: tarjeta de trade con botones aceptar/rechazar.
- `src/commands/gachaCommandHandler.js`: parser y ejecucion de comandos.
- `src/bot/client.js`: factory del cliente Discord.
- `src/bot/scheduler.js`: jobs de mantenimiento.

## Requisitos

- Node.js 18.17+ (recomendado Node 20)
- Bot de Discord con intent de `MESSAGE CONTENT` habilitado
- Firebase project con Firestore habilitado

## Configuracion

1. Copia `.env.example` a `.env`.
2. Completa `DISCORD_TOKEN`.
3. Configura Firebase con una de estas dos opciones:

Opcion A (recomendada): service account file
- Descarga la key JSON desde Firebase.
- Guarda el archivo local (ej: `serviceAccount.json`).
- Setea `FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccount.json`.

Opcion B: variables directas
- `FIREBASE_PROJECT_ID`
- `FIREBASE_CLIENT_EMAIL`
- `FIREBASE_PRIVATE_KEY` (con `\n` escapados)

Variables utiles:
- `PREFIX` (default `!`)
- `ROLLS_PER_DAY` (default `8`)
- `DAILY_ROLL_BONUS` (default `5`)
- `DAILY_COOLDOWN_MINUTES` (default `10`)
- `BOARD_SIZE` (default `50`)
- `BOARD_REFRESH_MINUTES` (default `60`)
- `BOARD_PREFETCH_MINUTES` (default `5`)
- `POOL_SIZE` (default `10000`)
- `BOT_TIMEZONE` (default `UTC`)

## Instalacion y ejecucion

```bash
npm install
npm start
```

## Comandos

- `!gacha help`
- `!gacha board` (carrusel con imagenes)
- `!gacha list` (lista paginada de 50 personajes por default)
- `!gacha mythics [pagina]` (lista de miticos del catalogo)
- `!gacha character <name|number>` (ficha + galeria multi-fuente)
- `!gacha roll [cantidad]`
- `!gacha daily` (+5 tiradas cada 10 minutos por default)
- `!gacha timer` (tiempo restante para el proximo refresh del board)
- `!gacha owners <personaje|id>` (lista usuarios que tienen ese personaje y cantidad)
- `!gacha contract [rareza] [cantidad] [--pick id[:copias],id[:copias],...]` (trade-up; para epic/legendary puedes elegir materiales)
- `!gacha trade @user <lo_tuyo> por <lo_que_pides>` (oferta de intercambio 1:1 con tarjeta y botones)
- `!gacha trade list` (ver pendientes recibidos/enviados)
- `!gacha trade accept <tradeId>` / `!gacha trade reject <tradeId>` / `!gacha trade cancel <tradeId>`
- `!gacha profile`
- `!gacha inventory [@user]` (carrusel, repetidos como `xN`)
- `!gacha refreshboard` (solo `GACHA_ADMIN_USER_ID`)

## Logica de probabilidades

1. Se obtiene un pool de personajes desde AniList (paginas aleatorias por sync para mayor diversidad).
2. Se calcula rareza por percentil de popularidad:
   - top 5% -> Mitico
   - top 20% -> Legendario
   - top 50% -> Epico
   - top 80% -> Raro
   - resto -> Comun
3. Cada personaje recibe `dropWeight`:
   - base por rareza
   - factor inverso por ranking de popularidad
4. El tablero toma una mezcla balanceada por rareza y la tirada usa weighted random.

## Notas

- Si AniList falla temporalmente, se usa fallback minimo de personajes.
- La galeria de imagenes mezcla fuentes (AniList + Jikan) para dar variedad.
- Firestore guarda:
  - estado global (`gacha/state`)
  - usuarios (`gacha_users/{userId}`)

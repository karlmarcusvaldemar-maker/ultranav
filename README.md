# Ultranav

En webbapp för VFR-navigering, anpassad för ultralätt flyg. Den är optimerad för iPad Pro 10,5" i både liggande och stående läge, och fungerar offline som hemskärmsapp (PWA).

## Funktioner
- **Rörlig karta** med GPS: norr-upp eller kurs-upp, följ-läge, fartvektor för 5 minuter och **glidräckviddsring** (glidtal × höjd över terrängen).
- **Instrumentlist**: GS, TRK (magnetisk), ALT, AGL, nästa punkt, BRG, DIST, ETE, ETA och UTC. Tryck på NÄSTA för att byta sträcka eller avbryta Direkt till.
- **Ruttplanering**: tryck på kartan och punkten fäster vid fält eller rapportpunkter. Tryck nära en sträcka för att infoga en punkt, och dra punkter för att flytta dem.
- **Navlogg**: MT/MH, vind på höjd (Open-Meteo, vektorinterpolerad mellan tryckytor), WCA, GS, tid, ETA, bränsle med reserv, samt solnedgång och skymning vid destinationen.
- **Luftrumskontroll längs rutten** (OpenAIP): visar om du är inne, under eller över, med frekvenser. **Varning i luften** när du är inne i eller närmar dig CTR/TMA/R/D/P.
- **Terrängprofil** med planerad höjd, luftrumsblock och varning för terrängmarginal.
- **Närmaste fält** (nödläge) med Direkt till. UL-fält är markerade.
- **Väder**: METAR/TAF, METAR-stationer på kartan efter flygväderkategori, nederbördsradar och modellprognos för avgång och ankomst.
- **Vektorkartor med MapLibre GL** (OpenFreeMap/OpenStreetMap): skarpa i alla zoomnivåer, med terrängskuggning. Fungerar även i kurs-upp-läge.
- **Ritverktyg (📐 Rita)**: mät avstånd (NM, km, °M och tid vid TAS). Rita linjer, ytor (area i km²/NM²) och punkter. Sparas, och kan exporteras och importeras som GeoJSON. En linje kan användas som rutt, och en punkt som Direkt till.
- **Fältinfo**: tryck på (eller nära) ett flygfält för banor, frekvenser, sol, och METAR/TAF som hämtas automatiskt.
- **Spårlogg** med GPX-export. **GPX-import och -export** av rutter, och sparade rutter.
- **Simulering** av rutten för träning på marken.
- **Offline**: spara kartbilder längs rutten. Luftrum och fält cachas i IndexedDB.
- Teman: mörkt, ljust (sol) och natt (rött).

## Datakällor (öppna)
| Källa | Innehåll | Nyckel |
|---|---|---|
| OpenStreetMap / OpenTopoMap | Baskartor | – |
| OpenFreeMap (OSM-vektordata) | Vektorkartor i MapLibre | – |
| Lantmäteriet Topowebb | Svensk topokarta (utgår 2026-12-31) | Gratis API-nyckel via Geotorget |
| Esri World Imagery | Satellit | – |
| open flightmaps | VFR-karta där OFM har täckning | – |
| OpenAIP | Luftrum, fält (inkl. UL), rapportpunkter | Gratis API-nyckel |
| OurAirports | Fält, banor och frekvenser (public domain) | – |
| Open-Meteo | Vind på höjd och prognos | – |
| aviationweather.gov (NOAA) | METAR/TAF | – (kan kräva CORS-proxy) |
| RainViewer | Radar | – |
| AWS Terrain Tiles | Terränghöjd | – |

Alla kart-URL:er kan ändras under **Inställningar › Avancerat** om en tjänst byter adress.

## Driftsättning
Statiska filer, inget byggsteg. Publicera katalogen på en HTTPS-värd, till exempel GitHub Pages, Netlify eller Cloudflare Pages. GPS och service worker kräver HTTPS.
Lokalt: `python3 -m http.server 8000` och öppna `http://localhost:8000`.

På iPad: öppna sidan i Safari, välj **Dela › Lägg till på hemskärmen** och tillåt platstjänster.
Obs: iPad-modeller med bara Wi-Fi saknar GPS-mottagare. Använd en mobildatamodell eller en extern GPS (t.ex. Bad Elf eller Garmin GLO).

## Viktigt
Appen är ett hjälpmedel. Den ersätter inte officiell AIP, ICAO-karta, NOTAM, briefing eller godkänd navigationsutrustning. Magnetisk variation anges manuellt i inställningarna.

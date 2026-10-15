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
- **Rita** samlar ruttplanering, terrängprofil och ritverktyg: mät avstånd (NM, km, °M och tid vid TAS). Rita linjer, ytor (area i km²/NM²) och punkter. Sparas, och kan exporteras och importeras som GeoJSON. En linje kan användas som rutt, och en punkt som Direkt till.
- **Fältinfo**: tryck på (eller nära) ett flygfält för banor, frekvenser, sol, och METAR/TAF som hämtas automatiskt.
- **Spårlogg** med GPX-export. **GPX-import och -export** av rutter, och sparade rutter.
- **Simulering** av rutten för träning på marken.
- **NOTAM**: knappen NOTAM öppnar LFV:s drönarkarta (dronechart.lfv.se) med aktuella NOTAM och AIP SUP.
- **Offline**: spara Standardkartan och terräng längs rutten. Luftrum och fält cachas i IndexedDB.
- Teman: mörkt, ljust (sol) och natt (rött). Egna linjeikoner i [`js/icons.js`](js/icons.js), grupperade kontroller och stora tryckytor.

## Datakällor (öppna)
| Källa | Innehåll | Nyckel |
|---|---|---|
| OpenStreetMap / OpenTopoMap | Vägkarta och topografikarta | – |
| OpenFreeMap (OSM-vektordata) | Standardkarta (MapLibre, förvald) | – |
| Kartverket (Norge) | Norgekarta, topografisk (CC BY 4.0) | – |
| Naturvårdsverket | Skyddade områden: nationalparker, naturreservat m.m. (WMS) | – |
| Länsstyrelsen (Vindbrukskollen) | Vindkraftverk (WMS, uppdateras dagligen) | – |
| EUMETSAT | Molnbild från satellit, infrarött (WMS) | – |
| Esri World Imagery | Satellit | – |
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

## CORS-proxy
Appen har en inbyggd proxy (`DEFAULT_PROXY` i [`js/config.js`](js/config.js)) som behövs för METAR/TAF.
Koden finns i [`tools/cors-proxy-worker.js`](tools/cors-proxy-worker.js). Den släpper bara igenom anrop från Ultranavs adresser, och bara till källorna i listan.
**När filen ändras** (ny källa eller ny adress): öppna workern i Cloudflare › **Edit code**, klistra in hela filen igen och tryck **Deploy**.

Egen proxy:
1. Skapa ett gratis konto på https://dash.cloudflare.com och gå till **Compute (Workers) › Create › Worker** ("Hello World").
2. Välj **Edit code**, ersätt koden med innehållet i filen och tryck **Deploy**.
3. Kopiera adressen, t.ex. `https://ultranav-proxy.<namn>.workers.dev`.
4. Ange adressen i Ultranav under **Inställn. › CORS-proxy**, eller som `DEFAULT_PROXY` i `js/config.js`.

## OpenAIP-nyckel
Lägg en OpenAIP-nyckel som `OPENAIP_KEY` i [`js/config.js`](js/config.js), så slipper användarna skaffa en egen.
Användare kan fortfarande ange en egen nyckel under Inställningar.

## Trafik: se andra Ultranav-piloter
Kartlagret **Trafik (Ultranav-piloter)** visar andra inloggade piloter som delar sin position. Delning är frivillig, avstängd som standard och väljs per enhet (Inställningar › Positionsdelning, eller statusrutan uppe till vänster när GPS:en är på). Positionerna skickas var femte sekund via Supabase Realtime i en privat kanal och sparas inte. Simulerade flygningar delas aldrig.
Kräver realtidsreglerna i `supabase/schema.sql` (avsnittet Trafik) — kör filen igen om databasen skapades tidigare.

## Konto och synk (Supabase)
Konton (e-post och lösenord), synk mellan enheter, säkerhetskopia, eget kartmaterial, loggbok och delning med länk använder [Supabase](https://supabase.com) (gratisnivå). Appen fungerar fullt ut utan konto, och då sparas allt bara på enheten.

1. Skapa ett gratis konto på supabase.com och skapa ett nytt projekt. Välj region **Stockholm** (eu-north-1) eller närmaste.
2. Öppna **SQL Editor › New query**, klistra in hela [`supabase/schema.sql`](supabase/schema.sql) och tryck **Run**.
3. Under **Authentication › URL Configuration**:
   - **Site URL:** `https://www.ultranav.se/`
   - **Redirect URLs:** `https://www.ultranav.se/**` och `https://ultranav.se/**` (behövs för bekräftelse- och återställningslänkar).
4. Under **Project Settings › API**, kopiera **Project URL** och **anon public / publishable key** till [`js/config.js`](js/config.js).

Nyckeln är avsedd att ligga i webbappen. Det är säkerhetsreglerna i databasen (Row Level Security) som gör att varje användare bara kommer åt sina egna data. Delat innehåll kan bara hämtas med sin delningskod.

Supabases inbyggda e-posttjänst skickar bara ett fåtal mejl per timme. Koppla in en egen SMTP-tjänst (t.ex. Resend) under **Authentication › Emails › SMTP Settings**.

**Svenska mejl:** under **Authentication › Emails › Templates**, klistra in mallarna från [`supabase/email-templates`](supabase/email-templates):

| Mall i Supabase | Ämnesrad | Fil |
|---|---|---|
| Confirm signup | Bekräfta ditt Ultranav-konto | `bekrafta-konto.html` |
| Reset password | Välj nytt lösenord för Ultranav | `nytt-losenord.html` |
| Change email address | Bekräfta ny e-postadress för Ultranav | `byt-epost.html` |
| Invite user | Inbjudan till Ultranav | `inbjudan.html` |

**Radera konto:** funktionen `delete_my_account` finns i `schema.sql`. Har databasen skapats med en äldre version, kör hela filen igen (den kan köras flera gånger).

### Eget kartmaterial
Kartor › Eget kartmaterial › **Lägg till kartmaterial**:
- **Filer:** KML, KMZ, GPX, GeoJSON eller shapefil (zip med .shp, .dbf, .shx och .prj; koordinatsystemet räknas om automatiskt).
- **WMS-tjänster:** adress och lager. Lagerlistan hämtas från tjänsten om den tillåter det.

Lager över cirka 9 MB sparas bara på enheten.

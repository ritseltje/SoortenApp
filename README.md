# SoortenApp

Telefoon-app (PWA) om soorten in Nederland te zoeken, te vinden en te loggen:
vogels, (vaat)planten, reptielen, amfibieën, zoogdieren, bijen, kevers, mieren, spinnen, paddenstoelen,
wantsen en cicaden, sprinkhanen en krekels, dag- en nachtvlinders (macro's), slakken, libellen en juffers,
hooiwagens en zweefvliegen.

- **Te zoeken**: algemene soorten die je nog niet hebt gelogd, gesorteerd op aantal waarnemingen in NL (laatste 15 jaar).
  Met **In de buurt** alleen soorten uit het hok waar je bent en de hokken eromheen (±15×15 km); via de kaart kun je ook een ander hok kiezen.
  Standaard verbergt de lijst soorten die buiten hun seizoen zijn: deze maand en de maanden ervoor en erna hebben samen minder dan 10% van de waarnemingen.
- **Kaart**: hokken van ±10×10 of ±5×5 km (kies in de legenda) gekleurd naar het aantal nog niet gelogde soorten; tik op een hok voor de soortenlijst.
- **Soorten**: orde › familie › geslacht › soort, met zoeken op Nederlandse of Latijnse naam.
- **Mijn lijst**: jaarlijst (aantal soorten en voortgang per groep per kalenderjaar, of alle jaren), je waarnemingen, export (CSV) en back-up/terugzetten.
  Bij het loggen meldt de app of een soort nieuw is voor je lijst of nieuw voor dat jaar.

Loggen bewaart tijdstip en GPS-locatie (aanpasbaar op de kaart), optioneel met foto. Een waarneming kun je later bewerken (✏️ in het soortscherm).
Kies je een foto met EXIF-gegevens, dan worden tijd en locatie uit de foto overgenomen.
Alle waarnemingen en foto's blijven op je telefoon (IndexedDB) — maak af en toe een back-up.

## Installeren op je telefoon

Open de app-URL (GitHub Pages) in Safari (iPhone) of Chrome (Android) en kies
**Zet op beginscherm** / **App installeren**. De app werkt daarna ook offline.

## Eigen icoontjes

Elke soortgroep heeft een emoji. Zet je een bestand `src/icons/<groep>.svg` (of `.png`) in de repository,
dan gebruikt de app dat plaatje in plaats van de emoji. De bestandsnaam is de groepscode, bijvoorbeeld
`libellen.svg`, `hooiwagens.svg`, `wantsen.svg`, `nachtvlinders.svg` of `zweefvliegen.svg`
(alle codes staan in `GROUPS` in `scripts/build-data.mjs`). Op GitHub: **Add file › Upload files**.
Een vierkant plaatje met doorzichtige achtergrond werkt het best.

## Gegevens

`scripts/build-data.mjs` maakt `public/data/species.json` en `grid.json` uit:

- [Nederlands Soortenregister](https://www.nederlandsesoorten.nl) (via de GBIF-checklist) — soorten, Nederlandse namen, taxonomie;
- [GBIF](https://www.gbif.org)-waarnemingen in Nederland — algemeenheid en hotspots;
- [verspreidingsatlas.nl](https://www.verspreidingsatlas.nl) — soortpagina's en extra Nederlandse plantennamen
  (alleen beschikbaar voor planten, zoogdieren, reptielen en amfibieën).

De workflow **Update species data** draait maandelijks (of handmatig via Actions) en commit nieuwe data;
daarna wordt de app automatisch opnieuw gepubliceerd.

## Ontwikkelen

```sh
npm install
npm run dev
```

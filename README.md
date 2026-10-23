# SoortenApp

Telefoon-app (PWA) om soorten in Nederland te zoeken, te vinden en te loggen:
vogels, (vaat)planten, reptielen, amfibieën, zoogdieren, bijen, kevers, mieren, spinnen en paddenstoelen.

- **Te zoeken**: algemene soorten die je nog niet hebt gelogd, gesorteerd op aantal waarnemingen in NL (laatste 15 jaar).
- **Kaart**: hokken van ±10×10 km gekleurd naar het aantal nog niet gelogde soorten; tik op een hok voor de soortenlijst.
- **Soorten**: orde › familie › geslacht › soort, met zoeken op Nederlandse of Latijnse naam.
- **Mijn lijst**: je waarnemingen, voortgang per groep, export (CSV) en back-up/terugzetten.

Loggen bewaart tijdstip en GPS-locatie (aanpasbaar op de kaart), optioneel met foto.
Kies je een foto met EXIF-gegevens, dan worden tijd en locatie uit de foto overgenomen.
Alle waarnemingen en foto's blijven op je telefoon (IndexedDB) — maak af en toe een back-up.

## Installeren op je telefoon

Open de app-URL (GitHub Pages) in Safari (iPhone) of Chrome (Android) en kies
**Zet op beginscherm** / **App installeren**. De app werkt daarna ook offline.

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

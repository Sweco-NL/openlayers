# Known issues

- Inzoomen op curve geometrie zorgt voor vreemd visueel gedrag wanneer heel ver ingezoomed wordt. Pixel coördinaten lopen hierbij in de honderden duizenden of zelfs miljoenen. Belangrijk is op te merken dat dit ook voor de reeds bestaande *Circle* geometrie geldt. In die zin wijken de nieuwe curves niet af van de enige curve geometrie die al aanwezig was.
    - Ver inzoomen betekent in deze een straal in pixels vanaf grofweg > 800.000.
    - Wanneer we de projectie van onze kaart in RD instellen en de maximale zoomfactor op +/- 20 zetten lijken we voorbereid op bogen met een straal van max. 1000 meter.
    - Voorlopig lijken we te kunnen werken met bovenstaande beperkingen. Als het toch een probleem wordt zullen we misschien moeten overwegen bogen te stroken, speciaal voor het tekenen, niet de bron geometrie.

```javascript
const map = new Map({
  layers: [raster, vector],
  target: 'map',
  view: new View({
    projection: Epsg28992,
    extent: netherlandsExtent,
    center: [155000, 463000],
    zoom: 10,
    maxZoom: 20,
  }),
});
```
# Publishing
To publish this extension of `ol` as a package on GitHub's registry, follow the steps below:

- Add the following entry to the `package.json` file:
```json
  "publishConfig": {
    "registry": "https://npm.pkg.github.com"
  },
```
- Change the package name to a scoped name `@<TEAMSCOPE>/ol` in the `package.json` file.
```json
  "name": "@NAMESPACE/ol",
```
- Change the repository url to the GitHub repository in the `package.json` file.
```json
  "repository": {
    "type": "git",
    "url": "git://github.com/<REPLACE WITH TEAMSCOPE>/openlayers.git"
  },
```
- Create a PAT (Personal Access Token) on GitHub with the `read:packages` and `write:packages` scopes. See [here](https://docs.github.com/en/github/authenticating-to-github/creating-a-personal-access-token) for more information.
- Create a NPM_TOKEN environment variable with the value of the PAT. On windows this can be done with the following command:
```powershell
$env:NPM_TOKEN="<PAT>"
```
On Linux/MacOS this can be done with the following command:
```bash
export NPM_TOKEN=<PAT>
```
- Build the package with `npm run build-package`.
- Run `cd build/ol` in the newly created directory.
- Create a `.npmrc` file in the `build/ol` of the project with the following content:
```
//npm.pkg.github.com/:_authToken=${NPM_TOKEN}
@NAMESPACE:registry=https://npm.pkg.github.com
```
- Run `npm publish` (inside the `build/ol` folder) to publish the package to GitHub's registry.
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

# Email Builder (web app)

Static web app (no build step) that assembles client email HTML from per-client themes.

## What's here
- `index.html`, `app.js` - the builder UI.
- `engine.js` - template/theme rendering engine.
- `admin.html`, `admin.js` - client settings / theme admin.
- `clients/<id>/` - per-client `config.json` + theme/template HTML; `clients/index.json` lists them.

## Running it
No build step. Serve the folder with any static web server, for example:

```bash
python3 -m http.server 8000
```

then open http://localhost:8000 (builder) or http://localhost:8000/admin.html (admin). Opening the files directly with `file://` won't work, because the pages fetch `clients/*.json`.

## Publishing client settings from the admin page
The admin page saves changes as commits to `Goodman-Campaigns/web-app` (branch `main`) through the GitHub API. Each person needs a GitHub fine-grained token with **Contents: read and write** on this repo; the admin page stores it in that browser's local storage only.

## Notes
No credentials or build tooling. Original repo: JacobGC22/email-builder (this is a clean export of the current commit, without git history).

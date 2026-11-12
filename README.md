# Email Builder (web app)

Static web app (no build step) that assembles client email HTML from per-client themes.

## What's here
- `index.html`, `app.js` - the builder UI.
- `engine.js` - template/theme rendering engine.
- `admin.html`, `admin.js` - client settings / theme admin.
- `clients/<id>/` - per-client `config.json` + theme/template HTML; `clients/index.json` lists them.
- `start.bat` - local launcher (Windows).

## Notes
No credentials or build tooling. Original repo: JacobGC22/email-builder (this is a clean export of the current commit, without git history).

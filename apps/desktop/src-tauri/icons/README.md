# App icons

This directory must contain the macOS bundle icons before
`pnpm desktop:build` will succeed. The Tauri config references the following
files:

- `32x32.png`
- `128x128.png`
- `128x128@2x.png` (256x256, retina)
- `icon.icns` (macOS bundle icon)
- `icon.ico` (Windows bundle icon, only required for Windows builds)

## Generating from a single source

Drop a single 1024x1024 PNG named `source.png` into this directory and run:

```bash
pnpm --filter @workflow-miner/desktop tauri icon src-tauri/icons/source.png
```

Tauri will emit all the required sizes plus `.icns` and `.ico` files in
place. This is the canonical way to keep the icon set in sync with a single
master.

## Until you have a real icon

The repo intentionally does not check in placeholder icons because Tauri
will silently bundle whatever is here. Generate real icons before the first
public release.

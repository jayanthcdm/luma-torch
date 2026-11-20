# LumaTorch

LumaTorch is a focused PDF reader for Linux. It opens one local PDF at a time and places a circular, adjustable spotlight over the reading viewport. The rest of the page is shaded until you move the pointer over it or switch to full-page visibility. PDF contents stay on the device; the app has no account, upload service, or document sync.

## Fedora setup

Use a supported Node.js release: Node 20.19+, 22.12+, or 24+. Node 22 LTS is a good choice for Fedora. Angular 21 also requires TypeScript 5.9 and supports RxJS 7, both pinned in this project.

```bash
sudo dnf install -y nodejs npm git rpm-build libxcrypt-compat
node --version
npm --version
```

Confirm Node reports `v20.19.0` or newer in the 20.x line, `v22.12.0` or newer in the 22.x line, or `v24.0.0` or newer in the 24.x line. Angular's supported Node and TypeScript combinations are listed in the [Angular version compatibility table](https://angular.dev/reference/versions).

Fedora Workstation already includes the GTK, NSS, ALSA, X11, and Mesa runtime libraries used by Electron. On a minimal Fedora installation, install them with:

```bash
sudo dnf install -y gtk3 nss alsa-lib libX11 libXcursor libXdamage libXrandr libXcomposite libXext libXfixes libXi libXrender libXtst libXScrnSaver mesa-libgbm libnotify xdg-utils
```

For Fedora Atomic desktops, install the same host runtime packages with `rpm-ostree install` and reboot before launching the application. Electron's Linux prerequisites can change as Chromium updates; check the [Electron Linux documentation](https://www.electronjs.org/docs/latest/development/build-instructions-linux/) if a newer Electron release adds a system dependency.

## Install and run in development

```bash
git clone https://github.com/jayanthcdm/luma-torch.git
cd luma-torch
npm ci
npm start
```

`npm start` launches the Angular development server and the Electron window together. The renderer is served only on `127.0.0.1:4200` while developing.

## Build and verify

```bash
npm test
npm run build
```

`npm test` runs the Angular/Vitest unit tests once. `npm run build` creates an optimized Angular renderer in `dist/luma-torch/browser/` and compiles Electron main/preload TypeScript into `dist-electron/`.

To launch the packaged application locally after building:

```bash
npx electron .
```

## Package for Fedora Linux

Build both an RPM and an AppImage:

```bash
npm run package:linux
```

Or build one format:

```bash
npm run package:rpm
npm run package:appimage
```

Install the RPM produced under `outputs/linux/` with:

```bash
sudo dnf install ./outputs/linux/luma-torch-1.0.0.x86_64.rpm
```

The AppImage is also written to `outputs/linux/`. If the host does not provide AppImage FUSE support, launch it with:

```bash
./outputs/linux/LumaTorch-1.0.0.AppImage --appimage-extract-and-run
```

Packaging downloads Electron's Linux runtime and the electron-builder Linux packaging tools on first use. The build machine therefore needs network access and `rpm-build` for RPM packaging. Build native Linux packages on Fedora when possible.

The package metadata currently uses the reserved `.invalid` URL because this local project has no public homepage yet. Replace `homepage` in `package.json` and set `linux.maintainer` to the actual package maintainer before distributing RPMs.

## Use

- **Open a PDF:** click **Open a PDF** or drag a `.pdf` onto the window. PDFs must be non-empty, valid, and at most 100 MB.
- **Move around:** use the page arrows, type a page number, or press `←` / `→`.
- **Zoom:** use the `−` and `+` controls. `0` resets zoom. Zoom is bounded to 50–200% of the available page width.
- **Full-page visibility:** click **Full page** or press `Space` to remove the shade. Toggle again to return to the spotlight.
- **Tune the light:** change radius, edge softness, and surrounding shade in the settings panel. Values are saved in local browser storage on this device.
- **Open another document:** use **Open another** or `Ctrl+O` (also `⌘+O` on macOS).

The spotlight tracks the pointer with animation-frame smoothing. Its mask belongs to the reading viewport, so it remains screen-aligned while the PDF scrolls and updates when the page zoom or viewport size changes.

## Architecture and security

- Angular 21 runs in the Electron renderer and uses PDF.js to parse and draw PDF pages locally.
- Electron's main process owns the native PDF chooser, enforces the 100 MB limit, checks the PDF header, and passes only the selected file's bytes and display name through one IPC handler.
- The preload exposes only `openPdf()`. The renderer has `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, and `webSecurity: true`.
- New windows are denied, and navigation is restricted to the local Angular origin or the packaged app document. Content Security Policy limits scripts, workers, and resources to the local app.
- The spotlight exists only above the PDF viewport inside this app window. It is not a system-wide desktop overlay.

## Current limitations

- Only PDF documents are supported. Password-protected, damaged, or unsupported PDFs show an error.
- Files are read into memory for PDF.js. The 100 MB size limit bounds this use.
- The RPM and AppImage targets package x86_64 builds. ARM packaging is not configured.
- No installer signing, auto-update service, recent-document list, annotations, printing, or system-wide overlay is included.

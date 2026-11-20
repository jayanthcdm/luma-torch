import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_PDF_BYTES = 100 * 1024 * 1024;
let mainWindow: BrowserWindow | null = null;

function isTrustedNavigation(url: string): boolean {
  const devUrl = process.env.ELECTRON_START_URL;
  try {
    if (devUrl) return new URL(url).origin === new URL(devUrl).origin;
    const appUrl = pathToFileURL(path.resolve(__dirname, '../dist/luma-torch/browser/index.html')).href;
    return url === appUrl;
  } catch {
    return false;
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 900,
    minHeight: 640,
    backgroundColor: '#0b0f14',
    title: 'LumaTorch',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedNavigation(url)) event.preventDefault();
  });

  const devUrl = process.env.ELECTRON_START_URL;
  if (devUrl) {
    void mainWindow.loadURL(devUrl);
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../dist/luma-torch/browser/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

ipcMain.handle('document:open', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) {
    throw new Error('This request is not available from this window.');
  }

  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Open a PDF in LumaTorch',
    properties: ['openFile'],
    filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
  });
  if (selection.canceled || selection.filePaths.length === 0) return { canceled: true as const };

  const selectedPath = selection.filePaths[0];
  const fileStat = await stat(selectedPath);
  if (!fileStat.isFile()) throw new Error('Choose a PDF document.');
  if (fileStat.size === 0) throw new Error('That file is empty. Choose a PDF document.');
  if (fileStat.size > MAX_PDF_BYTES) throw new Error('PDFs must be 100 MB or smaller.');

  const bytes = await readFile(selectedPath);
  if (bytes.byteLength > MAX_PDF_BYTES) throw new Error('PDFs must be 100 MB or smaller.');
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) {
    throw new Error('This file does not appear to be a valid PDF.');
  }

  const transferableBytes = Uint8Array.from(bytes).buffer;
  return { canceled: false as const, name: path.basename(selectedPath), bytes: transferableBytes };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

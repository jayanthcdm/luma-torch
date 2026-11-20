import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('lumaTorch', {
  openPdf: () => ipcRenderer.invoke('document:open')
});

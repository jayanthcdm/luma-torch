export {};

declare global {
  interface Window {
    lumaTorch?: {
      openPdf: () => Promise<{ canceled: true } | { canceled: false; name: string; bytes: ArrayBuffer }>;
    };
  }
}

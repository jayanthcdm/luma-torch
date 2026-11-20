import {
  AfterViewChecked,
  AfterViewInit,
  ChangeDetectorRef,
  Component,
  ElementRef,
  HostListener,
  inject,
  OnDestroy,
  ViewChild
} from '@angular/core';
import type { PDFDocumentProxy } from 'pdfjs-dist';

interface TorchSettings {
  radius: number;
  softness: number;
  darkness: number;
}

type PdfLoadingTask = {
  promise: Promise<PDFDocumentProxy>;
  destroy: () => Promise<void>;
};

type PdfRenderTask = {
  promise: Promise<void>;
  cancel: () => void;
};

const SETTINGS_KEY = 'luma-torch-settings-v1';
const MAX_FILE_SIZE = 100 * 1024 * 1024;
const DEFAULT_SETTINGS: TorchSettings = { radius: 260, softness: 92, darkness: 78 };

@Component({
  selector: 'lt-root',
  standalone: true,
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent implements AfterViewInit, AfterViewChecked, OnDestroy {
  private readonly changeDetector = inject(ChangeDetectorRef);
  @ViewChild('filePicker') private filePicker?: ElementRef<HTMLInputElement>;
  @ViewChild('pdfCanvas') private pdfCanvas?: ElementRef<HTMLCanvasElement>;
  @ViewChild('viewportShell') private viewportShell?: ElementRef<HTMLDivElement>;

  hasDocument = false;
  isLoading = false;
  isDragging = false;
  isFullVisibility = false;
  showShortcuts = false;
  fileName = '';
  pageCount = 0;
  currentPage = 1;
  zoom = 100;
  errorMessage = '';
  settings = this.readSettings();
  torchX = 0;
  torchY = 0;
  torchVisible = false;

  private pdfDocument?: PDFDocumentProxy;
  private loadingTask?: PdfLoadingTask;
  private renderTask?: PdfRenderTask;
  private loadRevision = 0;
  private renderRevision = 0;
  private resizeObserver?: ResizeObserver;
  private observedShell?: HTMLDivElement;
  private lastViewportWidth = 0;
  private targetX = 0;
  private targetY = 0;
  private animationFrame: number | null = null;
  private torchInitialized = false;

  get safeSoftness(): number {
    return Math.min(this.settings.softness, this.settings.radius - 1);
  }

  get darknessAlpha(): number {
    return this.settings.darkness / 100;
  }

  ngAfterViewInit(): void {
    this.observeViewport();
  }

  ngAfterViewChecked(): void {
    if (this.viewportShell?.nativeElement !== this.observedShell) this.observeViewport();
  }

  ngOnDestroy(): void {
    this.resizeObserver?.disconnect();
    if (this.animationFrame !== null) cancelAnimationFrame(this.animationFrame);
    this.renderTask?.cancel();
    void this.loadingTask?.destroy();
  }

  async openDocument(): Promise<void> {
    this.errorMessage = '';
    const bridge = window.lumaTorch;
    if (!bridge) {
      this.filePicker?.nativeElement.click();
      return;
    }

    this.isLoading = true;
    try {
      const selection = await bridge.openPdf();
      if (selection.canceled) {
        this.isLoading = false;
        return;
      }
      await this.loadPdf(selection.name, selection.bytes);
    } catch (error) {
      this.isLoading = false;
      this.errorMessage = this.errorText(error, 'LumaTorch could not open that file.');
      this.changeDetector.detectChanges();
    }
  }

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) await this.loadBrowserFile(file);
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    this.isDragging = true;
  }

  onDragLeave(event: DragEvent): void {
    const currentTarget = event.currentTarget;
    const nextTarget = event.relatedTarget;
    if (currentTarget instanceof HTMLElement && nextTarget instanceof Node && currentTarget.contains(nextTarget)) return;
    this.isDragging = false;
  }

  async onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    this.isDragging = false;
    const file = event.dataTransfer?.files[0];
    if (file) await this.loadBrowserFile(file);
  }

  async loadBrowserFile(file: File): Promise<void> {
    this.errorMessage = '';
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      this.errorMessage = 'Choose a PDF file to get started.';
      return;
    }
    if (file.size === 0) {
      this.errorMessage = 'That file is empty. Choose a PDF document.';
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      this.errorMessage = 'PDFs must be 100 MB or smaller.';
      return;
    }

    this.isLoading = true;
    try {
      const bytes = await file.arrayBuffer();
      if (!this.looksLikePdf(bytes)) {
        this.isLoading = false;
        this.errorMessage = 'This file does not appear to be a valid PDF.';
        this.changeDetector.detectChanges();
        return;
      }
      await this.loadPdf(file.name, bytes);
    } catch (error) {
      this.isLoading = false;
      this.errorMessage = this.errorText(error, 'LumaTorch could not read that file.');
      this.changeDetector.detectChanges();
    }
  }

  previousPage(): void {
    this.setPage(this.currentPage - 1);
  }

  nextPage(): void {
    this.setPage(this.currentPage + 1);
  }

  goToPage(event: Event): void {
    const input = event.target as HTMLInputElement;
    const requestedPage = Number(input.value);
    if (!Number.isInteger(requestedPage) || requestedPage < 1 || requestedPage > this.pageCount) {
      input.value = String(this.currentPage);
      return;
    }
    this.setPage(requestedPage);
  }

  setPage(page: number): void {
    if (!this.hasDocument || page < 1 || page > this.pageCount) return;
    this.currentPage = page;
    void this.renderCurrentPage();
  }

  changeZoom(amount: number): void {
    this.zoom = Math.max(50, Math.min(200, this.zoom + amount));
    void this.renderCurrentPage();
  }

  resetZoom(): void {
    this.zoom = 100;
    void this.renderCurrentPage();
  }

  toggleFullVisibility(): void {
    this.isFullVisibility = !this.isFullVisibility;
  }

  updateSetting(key: keyof TorchSettings, event: Event): void {
    const input = event.target as HTMLInputElement;
    const ranges: Record<keyof TorchSettings, [number, number]> = {
      radius: [140, 480],
      softness: [12, 220],
      darkness: [45, 92]
    };
    const [minimum, maximum] = ranges[key];
    const value = Math.max(minimum, Math.min(maximum, Math.round(Number(input.value))));
    this.settings = { ...this.settings, [key]: value };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(this.settings));
    } catch {
      // The current session still uses the updated settings if storage is unavailable.
    }
  }

  onPointerMove(event: PointerEvent): void {
    const shell = this.viewportShell?.nativeElement;
    if (!shell || this.isFullVisibility) return;
    const bounds = shell.getBoundingClientRect();
    this.targetX = Math.max(0, Math.min(bounds.width, event.clientX - bounds.left));
    this.targetY = Math.max(0, Math.min(bounds.height, event.clientY - bounds.top));
    this.torchVisible = true;

    if (!this.torchInitialized) {
      this.torchX = this.targetX;
      this.torchY = this.targetY;
      this.torchInitialized = true;
    }
    if (this.animationFrame === null) this.animationFrame = requestAnimationFrame(this.animateTorch);
  }

  onPointerLeave(): void {
    this.torchVisible = false;
    this.torchInitialized = false;
  }

  private readonly animateTorch = (): void => {
    this.torchX += (this.targetX - this.torchX) * 0.24;
    this.torchY += (this.targetY - this.torchY) * 0.24;
    if (Math.abs(this.targetX - this.torchX) < 0.3 && Math.abs(this.targetY - this.torchY) < 0.3) {
      this.torchX = this.targetX;
      this.torchY = this.targetY;
      this.animationFrame = null;
      return;
    }
    this.animationFrame = requestAnimationFrame(this.animateTorch);
  };

  private observeViewport(): void {
    this.resizeObserver?.disconnect();
    const shell = this.viewportShell?.nativeElement;
    this.observedShell = shell;
    if (!shell) return;

    this.lastViewportWidth = shell.clientWidth;
    this.resizeObserver = new ResizeObserver(() => {
      const width = shell.clientWidth;
      if (width !== this.lastViewportWidth) {
        this.lastViewportWidth = width;
        if (this.hasDocument) void this.renderCurrentPage();
      }
      this.torchX = Math.min(this.torchX, shell.clientWidth);
      this.torchY = Math.min(this.torchY, shell.clientHeight);
      this.targetX = Math.min(this.targetX, shell.clientWidth);
      this.targetY = Math.min(this.targetY, shell.clientHeight);
    });
    this.resizeObserver.observe(shell);
  }

  @HostListener('window:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    const target = event.target;
    const isTyping = target instanceof HTMLElement && (
      target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
    );
    if (isTyping || event.repeat) return;

    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'o') {
      event.preventDefault();
      void this.openDocument();
      return;
    }
    if (!isTyping && event.key === '?') {
      event.preventDefault();
      this.showShortcuts = !this.showShortcuts;
      return;
    }
    const isControl = target instanceof HTMLElement && target.closest('button, a, input, textarea, select, [role="button"]') !== null;
    if (isControl) return;
    if (!this.hasDocument) return;

    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      this.previousPage();
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      this.nextPage();
    } else if (event.key === '+' || event.key === '=') {
      event.preventDefault();
      this.changeZoom(10);
    } else if (event.key === '-') {
      event.preventDefault();
      this.changeZoom(-10);
    } else if (event.key === '0') {
      event.preventDefault();
      this.resetZoom();
    } else if (event.code === 'Space') {
      event.preventDefault();
      this.toggleFullVisibility();
    }
  }

  private async loadPdf(name: string, bytes: ArrayBuffer): Promise<void> {
    const revision = ++this.loadRevision;
    this.renderTask?.cancel();
    this.renderTask = undefined;
    const previousLoadingTask = this.loadingTask;
    this.loadingTask = undefined;
    this.pdfDocument = undefined;
    if (previousLoadingTask) void previousLoadingTask.destroy();

    this.hasDocument = false;
    this.isLoading = true;
    this.fileName = '';
    this.pageCount = 0;
    this.currentPage = 1;
    this.errorMessage = '';
    this.changeDetector.detectChanges();

    try {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = new URL('assets/pdf.worker.min.mjs', document.baseURI).toString();
      const task = pdfjs.getDocument({
        data: new Uint8Array(bytes),
        useSystemFonts: true,
        disableFontFace: false
      });
      this.loadingTask = task;
      const documentProxy = await task.promise;
      if (revision !== this.loadRevision) {
        await task.destroy();
        return;
      }
      this.pdfDocument = documentProxy;
      this.pageCount = documentProxy.numPages;
      this.fileName = name;
      this.currentPage = 1;
      this.hasDocument = true;
      this.isFullVisibility = false;
      this.torchVisible = false;
      this.zoom = 100;
      this.isLoading = false;
      this.changeDetector.detectChanges();
      await this.renderCurrentPage();
    } catch (error) {
      if (revision !== this.loadRevision) return;
      this.isLoading = false;
      this.hasDocument = false;
      this.errorMessage = this.errorText(error, 'This PDF could not be opened. It may be damaged or password protected.');
      const failedTask = this.loadingTask;
      this.loadingTask = undefined;
      if (failedTask) void failedTask.destroy();
      this.changeDetector.detectChanges();
    }
  }

  private async renderCurrentPage(): Promise<void> {
    const pdf = this.pdfDocument;
    if (!pdf || !this.pdfCanvas?.nativeElement || !this.viewportShell?.nativeElement) return;
    const revision = ++this.renderRevision;
    this.renderTask?.cancel();

    try {
      const page = await pdf.getPage(this.currentPage);
      if (revision !== this.renderRevision) return;
      let canvas = this.pdfCanvas?.nativeElement;
      const shell = this.viewportShell?.nativeElement;
      if (!canvas) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        canvas = this.pdfCanvas?.nativeElement;
      }
      if (revision !== this.renderRevision) return;
      if (!canvas || !shell) throw new Error('The PDF canvas is not available.');

      const baseViewport = page.getViewport({ scale: 1 });
      const availableWidth = Math.max(320, shell.clientWidth - 72);
      const fitScale = Math.min(1, availableWidth / baseViewport.width);
      const viewport = page.getViewport({ scale: fitScale * (this.zoom / 100) });
      const outputScale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
      canvas.width = Math.ceil(viewport.width * outputScale);
      canvas.height = Math.ceil(viewport.height * outputScale);
      canvas.style.width = `${Math.ceil(viewport.width)}px`;
      canvas.style.height = `${Math.ceil(viewport.height)}px`;

      const task = page.render({
        canvas,
        viewport,
        transform: outputScale === 1 ? undefined : [outputScale, 0, 0, outputScale, 0, 0],
        background: '#ffffff'
      });
      this.renderTask = task;
      await task.promise;
      if (revision === this.renderRevision) this.renderTask = undefined;
    } catch (error) {
      if (revision !== this.renderRevision || this.isCancellation(error)) return;
      this.errorMessage = this.errorText(error, 'This page could not be rendered.');
      this.changeDetector.detectChanges();
    }
  }

  private looksLikePdf(bytes: ArrayBuffer): boolean {
    const header = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 1024));
    const marker = [0x25, 0x50, 0x44, 0x46, 0x2d];
    for (let index = 0; index <= header.length - marker.length; index += 1) {
      if (marker.every((byte, offset) => header[index + offset] === byte)) return true;
    }
    return false;
  }

  private readSettings(): TorchSettings {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return { ...DEFAULT_SETTINGS };
      const parsed = JSON.parse(raw) as Partial<TorchSettings>;
      const clamp = (value: unknown, fallback: number, minimum: number, maximum: number): number => {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? Math.max(minimum, Math.min(maximum, numeric)) : fallback;
      };
      return {
        radius: clamp(parsed.radius, DEFAULT_SETTINGS.radius, 140, 480),
        softness: clamp(parsed.softness, DEFAULT_SETTINGS.softness, 12, 220),
        darkness: clamp(parsed.darkness, DEFAULT_SETTINGS.darkness, 45, 92)
      };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  private errorText(error: unknown, fallback: string): string {
    if (error instanceof Error && error.message) return error.message;
    if (typeof error === 'string' && error.length > 0) return error;
    return fallback;
  }

  private isCancellation(error: unknown): boolean {
    return error instanceof Error && (error.name === 'RenderingCancelledException' || error.name === 'AbortException');
  }
}

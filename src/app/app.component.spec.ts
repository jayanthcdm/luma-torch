import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    localStorage.clear();
    await TestBed.configureTestingModule({ imports: [AppComponent] }).compileComponents();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  it('shows the PDF drop area on the home screen', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Read at your');
    expect(fixture.nativeElement.textContent).toContain('drop a PDF anywhere here');
    expect(fixture.componentInstance.hasDocument).toBe(false);
    fixture.destroy();
  });

  it('toggles the full-page visibility state from the Space shortcut', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.hasDocument = true;

    const shortcut = new KeyboardEvent('keydown', { code: 'Space', key: ' ', cancelable: true });
    component.onKeydown(shortcut);

    expect(shortcut.defaultPrevented).toBe(true);
    expect(component.isFullVisibility).toBe(true);
    fixture.destroy();
  });

  it('keeps spotlight settings within their supported range', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const slider = document.createElement('input');
    slider.value = '999';
    const event = new Event('input');
    Object.defineProperty(event, 'target', { value: slider });

    fixture.componentInstance.updateSetting('radius', event);

    expect(fixture.componentInstance.settings.radius).toBe(480);
    expect(JSON.parse(localStorage.getItem('luma-torch-settings-v1') ?? '{}').radius).toBe(480);
    fixture.destroy();
  });

  it('opens and dismisses the keyboard shortcut guide', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    fixture.nativeElement.querySelector('.shortcuts-trigger').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Toggle full-page view');

    fixture.nativeElement.querySelector('.modal-done').click();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).toBeNull();
    fixture.destroy();
  });

  it('opens the keyboard shortcut guide with ?', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    fixture.componentInstance.onKeydown(new KeyboardEvent('keydown', { key: '?', cancelable: true }));
    fixture.detectChanges();

    expect(fixture.componentInstance.showShortcuts).toBe(true);
    expect(fixture.nativeElement.querySelector('[role="dialog"]')).not.toBeNull();
    fixture.destroy();
  });

  it('rejects files that are not PDFs with a clear message', async () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();

    await fixture.componentInstance.loadBrowserFile(new File(['not a document'], 'notes.txt'));

    expect(fixture.componentInstance.errorMessage).toContain('Choose a PDF file');
    expect(fixture.componentInstance.isLoading).toBe(false);
    fixture.destroy();
  });
});

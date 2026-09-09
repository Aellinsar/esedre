/**
 * Esedre Web Component Embed Bridge (<esedre-planner>)
 *
 * Provides a standardized W3C Custom Element for embedding the Esedre Developer
 * Planner into any web application, reverse proxy, or static documentation shell
 * without requiring host applications to bundle React, Lucide icons, or styling tokens.
 */

export class EsedrePlannerElement extends HTMLElement {
  static get observedAttributes(): string[] {
    return ['project', 'api-url', 'read-only', 'show-header'];
  }

  private container: HTMLDivElement | null = null;
  private iframe: HTMLIFrameElement | null = null;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
  }

  connectedCallback(): void {
    this.render();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue !== newValue && this.iframe) {
      this.updateIframeSrc();
    }
  }

  private get project(): string {
    return this.getAttribute('project') || 'all';
  }

  private get apiUrl(): string {
    return this.getAttribute('api-url') || '/api/planning';
  }

  private get isReadOnly(): boolean {
    return this.hasAttribute('read-only') && this.getAttribute('read-only') !== 'false';
  }

  private get showHeader(): boolean {
    return this.getAttribute('show-header') !== 'false';
  }

  private buildUrl(): string {
    const base = this.apiUrl.replace(/\/+$/, '');
    const params = new URLSearchParams();
    if (this.project && this.project !== 'all') {
      params.set('project', this.project);
    }
    if (this.isReadOnly) {
      params.set('readOnly', 'true');
    }
    if (!this.showHeader) {
      params.set('showHeader', 'false');
    }
    const qs = params.toString();
    return `${base}/view${qs ? `?${qs}` : ''}`;
  }

  private updateIframeSrc(): void {
    if (this.iframe) {
      this.iframe.src = this.buildUrl();
    }
  }

  private render(): void {
    if (!this.shadowRoot) return;

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
          height: 100%;
          min-height: 400px;
          overflow: hidden;
          background: #0f172a;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        }
        .esedre-frame-wrapper {
          width: 100%;
          height: 100%;
          display: flex;
          flex-direction: column;
          position: relative;
        }
        iframe {
          width: 100%;
          height: 100%;
          border: none;
          flex: 1;
        }
      </style>
      <div class="esedre-frame-wrapper">
        <iframe
          src="${this.buildUrl()}"
          title="Esedre Developer Planner"
          allow="clipboard-read; clipboard-write"
          loading="lazy"
        ></iframe>
      </div>
    `;

    this.iframe = this.shadowRoot.querySelector('iframe');
  }
}

// Auto-register custom element if in a browser environment
if (typeof window !== 'undefined') {
  if (!customElements.get('esedre-planner')) {
    customElements.define('esedre-planner', EsedrePlannerElement);
  }
}


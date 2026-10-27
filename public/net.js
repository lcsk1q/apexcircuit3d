// public/net.js - WebSocket com reconexão automática (celular em 2º plano, Render dormindo)
export class Net {
  constructor(handlers) {
    this.h = handlers;
    this.ws = null;
    this.retry = 0;
    this.token = localStorage.getItem('apex_token');
    if (!this.token) {
      this.token = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('apex_token', this.token);
    }
    // Celular volta do 2º plano → reconecta na hora em vez de esperar o backoff
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden && (!this.ws || this.ws.readyState === 3)) { clearTimeout(this.timer); this.connect(); }
    });
    setInterval(() => this.send({ type: 'ping' }), 20000);   // evita o proxy fechar conexão ociosa
  }

  get open() { return this.ws && this.ws.readyState === 1; }

  connect() {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    this.h.status?.('connecting');
    this.ws = new WebSocket(`${proto}://${location.host}`);
    this.ws.onopen = () => { this.retry = 0; this.h.status?.('online'); this.hello(); };
    this.ws.onmessage = (e) => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      this.h[m.type]?.(m);
    };
    this.ws.onclose = () => {
      this.h.status?.('offline');
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.retry++));
    };
    this.ws.onerror = () => this.ws.close();
  }

  hello() { this.send({ type: 'hello', token: this.token, name: this.h.getName(), carType: this.h.getCar() }); }
  send(o) { if (this.open) this.ws.send(JSON.stringify(o)); }
}

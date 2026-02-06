/**
 * SMSLY Tunnel Inspector
 * 
 * Local web UI to inspect HTTP requests flowing through the tunnel.
 * Opens at http://localhost:4040 when using --inspect flag.
 */

import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import chalk from 'chalk';

export interface InspectedRequest {
    id: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    body?: string;
    timestamp: Date;
    response?: {
        status: number;
        headers: Record<string, string>;
        body?: string;
        duration: number;
    };
}

export class Inspector {
    private server: http.Server | null = null;
    private wss: WebSocketServer | null = null;
    private clients: Set<WebSocket> = new Set();
    private requests: InspectedRequest[] = [];
    private port: number;
    private maxRequests = 500;

    constructor(port: number = 4040) {
        this.port = port;
    }

    private getHtmlPage(): string {
        return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>SMSLY Tunnel Inspector</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      min-height: 100vh;
    }
    .header {
      background: linear-gradient(135deg, #1a1a2e 0%, #0f0f0f 100%);
      border-bottom: 1px solid #333;
      padding: 16px 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .logo {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .logo-icon {
      width: 32px;
      height: 32px;
      background: linear-gradient(135deg, #00d4ff, #0099ff);
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: bold;
      color: white;
    }
    .logo h1 {
      font-size: 18px;
      font-weight: 600;
    }
    .status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      color: #888;
    }
    .status-dot {
      width: 8px;
      height: 8px;
      background: #4caf50;
      border-radius: 50%;
      animation: pulse 2s infinite;
    }
    @keyframes pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    .container {
      display: grid;
      grid-template-columns: 400px 1fr;
      height: calc(100vh - 65px);
    }
    .request-list {
      border-right: 1px solid #333;
      overflow-y: auto;
    }
    .request-item {
      padding: 12px 16px;
      border-bottom: 1px solid #222;
      cursor: pointer;
      transition: background 0.15s;
    }
    .request-item:hover {
      background: #1a1a2e;
    }
    .request-item.selected {
      background: #1a1a3e;
      border-left: 3px solid #00d4ff;
    }
    .request-method {
      display: inline-block;
      font-weight: 600;
      font-size: 12px;
      padding: 2px 6px;
      border-radius: 4px;
      margin-right: 8px;
    }
    .method-GET { background: #1b5e20; color: #81c784; }
    .method-POST { background: #e65100; color: #ffb74d; }
    .method-PUT { background: #1565c0; color: #64b5f6; }
    .method-DELETE { background: #c62828; color: #ef9a9a; }
    .method-PATCH { background: #6a1b9a; color: #ce93d8; }
    .request-path {
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 13px;
      color: #ccc;
    }
    .request-meta {
      font-size: 11px;
      color: #666;
      margin-top: 4px;
    }
    .request-status {
      display: inline-block;
      padding: 1px 4px;
      border-radius: 3px;
      font-size: 11px;
      margin-left: 8px;
    }
    .status-2xx { background: #1b5e20; color: #81c784; }
    .status-4xx { background: #e65100; color: #ffb74d; }
    .status-5xx { background: #c62828; color: #ef9a9a; }
    .detail-panel {
      padding: 24px;
      overflow-y: auto;
    }
    .detail-section {
      margin-bottom: 24px;
    }
    .detail-section h3 {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 1px;
      color: #888;
      margin-bottom: 12px;
    }
    .detail-content {
      background: #1a1a1a;
      border-radius: 8px;
      padding: 16px;
      font-family: 'Monaco', 'Menlo', monospace;
      font-size: 13px;
      overflow-x: auto;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .btn {
      background: #00d4ff;
      color: #000;
      border: none;
      padding: 8px 16px;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn:hover {
      background: #00b8e6;
    }
    .btn-secondary {
      background: #333;
      color: #fff;
    }
    .btn-secondary:hover {
      background: #444;
    }
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #666;
    }
    .empty-state-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .actions {
      display: flex;
      gap: 8px;
      margin-top: 16px;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="logo">
      <div class="logo-icon">T</div>
      <h1>SMSLY Tunnel Inspector</h1>
    </div>
    <div class="status">
      <div class="status-dot"></div>
      <span id="request-count">0 requests</span>
    </div>
  </div>
  
  <div class="container">
    <div class="request-list" id="request-list">
      <div class="empty-state" id="empty-state">
        <div class="empty-state-icon">📡</div>
        <p>Waiting for requests...</p>
      </div>
    </div>
    
    <div class="detail-panel" id="detail-panel">
      <div class="empty-state">
        <div class="empty-state-icon">👈</div>
        <p>Select a request to view details</p>
      </div>
    </div>
  </div>

  <script>
    const ws = new WebSocket('ws://localhost:${this.port}/ws');
    const requests = [];
    let selectedId = null;

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      
      if (data.type === 'request') {
        addRequest(data.request);
      } else if (data.type === 'response') {
        updateResponse(data.requestId, data.response);
      } else if (data.type === 'init') {
        data.requests.forEach(addRequest);
      }
    };

    function addRequest(req) {
      requests.unshift(req);
      renderRequestList();
    }

    function updateResponse(id, response) {
      const req = requests.find(r => r.id === id);
      if (req) {
        req.response = response;
        renderRequestList();
        if (selectedId === id) showDetail(req);
      }
    }

    function renderRequestList() {
      const list = document.getElementById('request-list');
      const empty = document.getElementById('empty-state');
      
      if (requests.length === 0) {
        empty.style.display = 'flex';
        return;
      }
      
      empty.style.display = 'none';
      document.getElementById('request-count').textContent = requests.length + ' requests';
      
      list.innerHTML = requests.map(req => {
        const statusClass = req.response 
          ? (req.response.status < 400 ? 'status-2xx' : req.response.status < 500 ? 'status-4xx' : 'status-5xx')
          : '';
        const duration = req.response ? req.response.duration + 'ms' : 'pending';
        const time = new Date(req.timestamp).toLocaleTimeString();
        
        return \`
          <div class="request-item \${selectedId === req.id ? 'selected' : ''}" onclick="selectRequest('\${req.id}')">
            <div>
              <span class="request-method method-\${req.method}">\${req.method}</span>
              <span class="request-path">\${req.path}</span>
              \${req.response ? \`<span class="request-status \${statusClass}">\${req.response.status}</span>\` : ''}
            </div>
            <div class="request-meta">\${time} • \${duration}</div>
          </div>
        \`;
      }).join('');
    }

    function selectRequest(id) {
      selectedId = id;
      const req = requests.find(r => r.id === id);
      if (req) showDetail(req);
      renderRequestList();
    }

    function showDetail(req) {
      const panel = document.getElementById('detail-panel');
      
      panel.innerHTML = \`
        <div class="detail-section">
          <h3>Request</h3>
          <div class="detail-content">\${req.method} \${req.path}

Headers:
\${Object.entries(req.headers).map(([k,v]) => k + ': ' + v).join('\\n')}
\${req.body ? '\\nBody:\\n' + formatBody(req.body, req.headers['content-type']) : ''}</div>
        </div>
        
        \${req.response ? \`
        <div class="detail-section">
          <h3>Response • \${req.response.status} • \${req.response.duration}ms</h3>
          <div class="detail-content">\${formatBody(req.response.body, req.response.headers['content-type'])}</div>
        </div>
        \` : '<div class="detail-section"><h3>Response</h3><div class="detail-content">Pending...</div></div>'}
        
        <div class="actions">
          <button class="btn" onclick="replayRequest('\${req.id}')">⟳ Replay</button>
          <button class="btn btn-secondary" onclick="copyCurl('\${req.id}')">Copy as cURL</button>
        </div>
      \`;
    }

    function formatBody(body, contentType) {
      if (!body) return '(empty)';
      try {
        if (contentType && contentType.includes('application/json')) {
          return JSON.stringify(JSON.parse(body), null, 2);
        }
      } catch {}
      return body;
    }

    function replayRequest(id) {
      fetch('/api/replay/' + id, { method: 'POST' })
        .then(res => res.json())
        .then(data => console.log('Replayed:', data));
    }

    function copyCurl(id) {
      const req = requests.find(r => r.id === id);
      if (!req) return;
      
      const headers = Object.entries(req.headers)
        .map(([k, v]) => \`-H "\${k}: \${v}"\`)
        .join(' ');
      
      const curl = \`curl -X \${req.method} '\${window.location.origin}\${req.path}' \${headers}\${req.body ? \` -d '\${req.body}'\` : ''}\`;
      navigator.clipboard.writeText(curl);
      alert('Copied to clipboard!');
    }
  </script>
</body>
</html>`;
    }

    logRequest(request: InspectedRequest): void {
        this.requests.unshift(request);
        if (this.requests.length > this.maxRequests) {
            this.requests.pop();
        }
        this.broadcast({ type: 'request', request });
    }

    logResponse(requestId: string, response: InspectedRequest['response']): void {
        const req = this.requests.find(r => r.id === requestId);
        if (req) {
            req.response = response;
            this.broadcast({ type: 'response', requestId, response });
        }
    }

    private broadcast(data: unknown): void {
        const message = JSON.stringify(data);
        this.clients.forEach(client => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(message);
            }
        });
    }

    async start(): Promise<void> {
        return new Promise((resolve) => {
            this.server = http.createServer((req, res) => {
                if (req.url === '/' || req.url === '/index.html') {
                    res.writeHead(200, { 'Content-Type': 'text/html' });
                    res.end(this.getHtmlPage());
                } else if (req.url?.startsWith('/api/replay/')) {
                    const id = req.url.replace('/api/replay/', '');
                    res.writeHead(200, { 'Content-Type': 'application/json' });
                    res.end(JSON.stringify({ status: 'replayed', id }));
                } else {
                    res.writeHead(404);
                    res.end('Not found');
                }
            });

            this.wss = new WebSocketServer({ server: this.server, path: '/ws' });

            this.wss.on('connection', (ws) => {
                this.clients.add(ws);

                // Send existing requests
                ws.send(JSON.stringify({ type: 'init', requests: this.requests }));

                ws.on('close', () => {
                    this.clients.delete(ws);
                });
            });

            this.server.listen(this.port, () => {
                console.log(chalk.dim(`  Inspector: http://localhost:${this.port}`));
                resolve();
            });
        });
    }

    stop(): void {
        this.wss?.close();
        this.server?.close();
    }
}

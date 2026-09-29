// ============================================================
// Notehelper · 本地开发 / 演示服务器（Node >= 18，零依赖）
//   1. 静态托管 www/（浏览器打开 http://localhost:8080 即可完整体验）
//   2. POST /api/deepseek —— AI 代理：把请求体里的 key 换成
//      Authorization 头转发给 DeepSeek 官方接口，绕开浏览器 CORS
//      （前端 NHAI 优先走这里，代理不在时自动回退直连）
// 用法：
//   node server.js                # 默认 8080 端口
//   PORT=3000 node server.js      # 自定义端口
// ============================================================
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 8080;
const WWW = path.join(__dirname, 'www');
const UPSTREAM = 'https://api.deepseek.com/chat/completions';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

function sendJSON(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    req.on('data', function (c) {
      size += c.length;
      if (size > 20 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () { resolve(Buffer.concat(chunks).toString('utf8')); });
    req.on('error', reject);
  });
}

/* ---- AI 代理：body 里的 key → Authorization 头，其余原样转发 ---- */
async function handleDeepseek(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return sendJSON(res, 400, { error: { message: '请求体不是有效的 JSON' } });
  }
  const key = (payload && payload.key) || process.env.DEEPSEEK_KEY || '';
  if (!key) return sendJSON(res, 401, { error: { message: '缺少 API 密钥' } });

  // 代理自身字段不下发
  const upstream = Object.assign({}, payload);
  delete upstream.key;

  try {
    const r = await fetch(UPSTREAM, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + key
      },
      body: JSON.stringify(upstream)
    });
    const text = await r.text();
    res.writeHead(r.status, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store'
    });
    res.end(text);
  } catch (e) {
    sendJSON(res, 502, { error: { message: '代理请求上游失败：' + (e && e.message ? e.message : e) } });
  }
}

/* ---- 静态文件：只允许 www/ 下的相对路径（防目录穿越） ---- */
function handleStatic(req, res) {
  let urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
  if (urlPath === '/') urlPath = '/index.html';
  const filePath = path.normalize(path.join(WWW, urlPath));
  if (!filePath.startsWith(WWW)) {
    res.writeHead(403); res.end('Forbidden'); return;
  }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404); res.end('Not Found'); return; }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(data);
  });
}

const server = http.createServer(function (req, res) {
  if (req.method === 'POST' && (req.url === '/api/deepseek' || req.url.startsWith('/api/deepseek?'))) {
    handleDeepseek(req, res);
    return;
  }
  if (req.method === 'GET' || req.method === 'HEAD') {
    handleStatic(req, res);
    return;
  }
  res.writeHead(405); res.end('Method Not Allowed');
});

server.listen(PORT, function () {
  console.log('[notehelper] http://localhost:' + PORT +
    '  （静态站 + /api/deepseek 代理；AI 功能仍需在「我的」页填入 DeepSeek 密钥）');
});

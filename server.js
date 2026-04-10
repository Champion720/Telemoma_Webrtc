const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

// HTTP 服务器：提供静态 HTML 文件
const httpServer = http.createServer((req, res) => {
  let filePath = path.join(__dirname, req.url === '/' ? '/sender.html' : req.url);
  const ext = path.extname(filePath);
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
  };

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    res.end(data);
  });
});

// WebSocket 信令服务器
const wss = new WebSocketServer({ server: httpServer });

let sender = null;
let receiver = null;
let pendingOffer = null; // 缓存 Offer，防止手机晚连接时 Offer 丢失

wss.on('connection', (ws) => {
  console.log('[信令] 新连接接入');

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    switch (msg.type) {
      // 身份注册
      case 'register':
        if (msg.role === 'sender') {
          sender = ws;
          console.log('[信令] 发送方已注册');
          if (receiver) ws.send(JSON.stringify({ type: 'receiver_ready' }));
        } else if (msg.role === 'receiver') {
          receiver = ws;
          console.log('[信令] 接收方已注册');
          // 通知发送方接收方已就绪
          if (sender) sender.send(JSON.stringify({ type: 'receiver_ready' }));
          // 如果发送方已发过 Offer（手机晚连接场景），立即补发
          if (pendingOffer) {
            console.log('[信令] 补发缓存的 Offer 给接收方');
            ws.send(JSON.stringify(pendingOffer));
          }
        }
        break;

      // 转发 SDP Offer（发送方 → 接收方）
      case 'offer':
        console.log('[信令] 转发 SDP Offer');
        pendingOffer = msg; // 缓存，以备晚连接的接收方
        if (receiver) receiver.send(JSON.stringify(msg));
        break;

      // 转发 SDP Answer（接收方 → 发送方）
      case 'answer':
        console.log('[信令] 转发 SDP Answer');
        pendingOffer = null; // 连接已应答，清除缓存
        if (sender) sender.send(JSON.stringify(msg));
        break;

      // 转发 ICE 候选
      case 'ice':
        console.log('[信令] 转发 ICE Candidate，目标:', msg.target);
        if (msg.target === 'receiver' && receiver) {
          receiver.send(JSON.stringify(msg));
        } else if (msg.target === 'sender' && sender) {
          sender.send(JSON.stringify(msg));
        }
        break;
    }
  });

  ws.on('close', () => {
    if (ws === sender) {
      sender = null;
      pendingOffer = null;
      console.log('[信令] 发送方断开');
    }
    if (ws === receiver) { receiver = null; console.log('[信令] 接收方断开'); }
  });

  ws.on('error', (err) => console.error('[信令] WS 错误:', err.message));
});

const PORT = 3000;
httpServer.listen(PORT, '0.0.0.0', () => {
  // 获取本机所有局域网 IP（修复：正确跳出双层循环）
  const { networkInterfaces } = require('os');
  const nets = networkInterfaces();
  const localIPs = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (net.family === 'IPv4' && !net.internal) {
        localIPs.push({ name, address: net.address });
      }
    }
  }
  console.log(`\n✅ 信令服务器已启动，端口 ${PORT}`);
  console.log(`   PC 发送端:  http://localhost:${PORT}/sender.html`);
  if (localIPs.length === 0) {
    console.log(`   ⚠️  未检测到局域网 IP，请手动查看本机 IP`);
  } else {
    localIPs.forEach(({ name, address }) => {
      console.log(`   手机接收端: http://${address}:${PORT}/receiver.html  (网卡: ${name})`);
    });
  }
  console.log(`\n   ⚠️  请确认手机与 PC 在同一 WiFi 下`);
  console.log(`   ⚠️  如手机无法访问，请在 Windows 防火墙中放行端口 ${PORT}\n`);
});

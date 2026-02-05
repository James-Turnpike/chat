const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')
const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url
  const filePath = path.join(__dirname, '..', 'public', url)
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }
    const ext = path.extname(filePath)
    const type = ext === '.html' ? 'text/html' : ext === '.css' ? 'text/css' : ext === '.js' ? 'text/javascript' : 'application/octet-stream'
    res.writeHead(200, { 'Content-Type': type })
    res.end(data)
  })
})
const wss = new WebSocket.Server({ noServer: true })
const clients = new Set()
wss.on('connection', ws => {
  clients.add(ws)
  ws.on('message', message => {
    let data
    try {
      data = JSON.parse(message)
    } catch (e) {
      return
    }
    if (data && data.type === 'ping') return
    const nickRaw = String(data.nick || '')
    const textRaw = String(data.text || '')
    const nickTrim = nickRaw.trim()
    const nick = (nickTrim ? nickTrim : '游客').slice(0, 20)
    const text = textRaw.trim().slice(0, 500)
    if (!text) return
    const payload = {
      id: Date.now().toString(36) + Math.random().toString(16).slice(2),
      nick,
      text,
      time: new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' }),
      ts: Date.now()
    }
    const str = JSON.stringify(payload)
    clients.forEach(c => {
      if (c.readyState === WebSocket.OPEN) c.send(str)
    })
  })
  ws.on('close', () => {
    clients.delete(ws)
  })
})
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, ws => {
      wss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})
const port = process.env.PORT || 3000
server.listen(port, () => {})

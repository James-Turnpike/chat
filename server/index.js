const http = require('http')
const fs = require('fs')
const path = require('path')
const WebSocket = require('ws')

const MIME_TYPES = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml'
}

const fileCache = new Map()

const server = http.createServer((req, res) => {
  const url = req.url === '/' ? '/index.html' : req.url
  const filePath = path.join(__dirname, '..', 'public', url)
  
  if (fileCache.has(filePath)) {
    const { data, type } = fileCache.get(filePath)
    res.writeHead(200, { 'Content-Type': type })
    res.end(data)
    return
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not Found')
      return
    }
    const ext = path.extname(filePath).toLowerCase()
    const type = MIME_TYPES[ext] || 'application/octet-stream'
    
    // 简单的缓存策略：只缓存较小的文件
    if (data.length < 1024 * 1024) {
      fileCache.set(filePath, { data, type })
    }

    res.writeHead(200, { 'Content-Type': type })
    res.end(data)
  })
})

const wss = new WebSocket.Server({ noServer: true })
const clients = new Set()

// 每30秒检查一次连接活跃度
const interval = setInterval(() => {
  wss.clients.forEach(ws => {
    if (ws.isAlive === false) return ws.terminate()
    ws.isAlive = false
    ws.ping()
  })
}, 30000)

wss.on('close', () => {
  clearInterval(interval)
})

wss.on('connection', (ws, req) => {
  const ip = req.socket.remoteAddress
  console.log(`[WS] New connection from ${ip}`)
  ws.isAlive = true
  
  ws.on('pong', () => {
    ws.isAlive = true
  })

  clients.add(ws)

  ws.on('message', message => {
    ws.isAlive = true // 收到任何消息都认为活跃
    let data
    try {
      data = JSON.parse(message)
    } catch (e) { return }

    if (data && data.type === 'ping') {
      try {
        ws.send(JSON.stringify({ type: 'pong', ts: Date.now() }))
      } catch (e) {}
      return
    }

    const nick = (String(data.nick || '').trim() || '游客').slice(0, 20)
    const text = String(data.text || '').trim().slice(0, 1000)
    
    if (!text) return

    const payload = {
      id: `${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 6)}`,
      nick,
      text,
      ts: Date.now()
    }

    const str = JSON.stringify(payload)
    clients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(str)
        } catch (e) {
          clients.delete(client)
        }
      }
    })
  })

  ws.on('close', () => {
    console.log(`[WS] Connection closed: ${ip}`)
    clients.delete(ws)
  })

  ws.on('error', (err) => {
    console.error(`[WS] Error: ${err.message}`)
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
server.listen(port, () => {
  console.log(`Server running at http://localhost:${port}/`)
})

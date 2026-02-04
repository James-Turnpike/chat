const nick = localStorage.getItem('nick') || ('游客' + Math.floor(Math.random() * 1000))
localStorage.setItem('nick', nick)
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')
const input = document.getElementById('input')
const send = document.getElementById('send')
const list = document.getElementById('messages')
const counter = document.getElementById('counter')
const clearBtn = document.getElementById('clear')
let lastDay = ''
let colorCache
try {
  colorCache = JSON.parse(localStorage.getItem('colorCache') || '{}')
} catch (e) {
  colorCache = {}
}
send.disabled = true
input.addEventListener('input', () => {
  const t = input.value.trim()
  send.disabled = t.length === 0 || ws.readyState !== 1
  if (counter) {
    counter.textContent = (t.length) + '/500'
    counter.className = 'counter' + (t.length > 490 ? ' danger' : (t.length > 400 ? ' warn' : ''))
  }
})
const statusBar = document.getElementById('status')
ws.addEventListener('open', () => {
  const t = input.value.trim()
  send.disabled = t.length === 0
  input.placeholder = '输入消息（回车发送）...'
  if (statusBar) statusBar.style.display = 'none'
  try { input.focus() } catch (e) {}
})
ws.addEventListener('close', () => {
  send.disabled = true
  input.placeholder = '正在连接...'
  if (statusBar) statusBar.style.display = 'flex'
})
if (clearBtn) {
  clearBtn.addEventListener('click', () => {
    list.innerHTML = ''
    lastDay = ''
    try { input.focus() } catch (e) {}
  })
}
ws.addEventListener('message', e => {
  let data
  try {
    data = JSON.parse(e.data)
  } catch (err) {
    return
  }
  const ts = typeof data.ts === 'number' ? data.ts : Date.now()
  const d = new Date(ts)
  const pad = n => (n < 10 ? '0' + n : '' + n)
  const day = pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  if (day !== lastDay) {
    const sep = document.createElement('div')
    sep.className = 'day-sep'
    const t = document.createElement('div')
    t.className = 'sep'
    t.textContent = day
    sep.appendChild(t)
    list.appendChild(sep)
    lastDay = day
  }
  const wrap = document.createElement('div')
  const self = data.nick === nick
  wrap.className = 'msg ' + (self ? 'self' : 'other')

  // Generate avatar
  const avatar = document.createElement('div')
  avatar.className = 'avatar'
  const key = (data.nick || '').trim().toLowerCase()
  let color = colorCache[key]
  if (!color) {
    let hash = 0
    for (let i = 0; i < data.nick.length; i++) {
      hash = data.nick.charCodeAt(i) + ((hash << 5) - hash)
    }
    const hue = Math.abs(hash) % 360
    const hslToHex = (h, s, l) => {
      s /= 100; l /= 100
      const c = (1 - Math.abs(2 * l - 1)) * s
      const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
      const m = l - c / 2
      let r = 0, g = 0, b = 0
      if (0 <= h && h < 60) { r = c; g = x; b = 0 }
      else if (60 <= h && h < 120) { r = x; g = c; b = 0 }
      else if (120 <= h && h < 180) { r = 0; g = c; b = x }
      else if (180 <= h && h < 240) { r = 0; g = x; b = c }
      else if (240 <= h && h < 300) { r = x; g = 0; b = c }
      else { r = c; g = 0; b = x }
      const toHex = v => Math.round((v + m) * 255).toString(16).padStart(2, '0')
      return '#' + toHex(r) + toHex(g) + toHex(b)
    }
    color = hslToHex(hue, 45, 78)
    colorCache[key] = color
    try { localStorage.setItem('colorCache', JSON.stringify(colorCache)) } catch (e) {}
  }
  avatar.style.background = color
  // set readable text color
  const hex = color.replace('#','')
  const bigint = parseInt(hex.length === 3 ? hex.split('').map(c => c + c).join('') : hex, 16)
  const r = (bigint >> 16) & 255, g = (bigint >> 8) & 255, b = bigint & 255
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  avatar.style.color = luminance > 0.68 ? '#1a1a1a' : '#ffffff'
  avatar.textContent = data.nick[0] ? data.nick[0].toUpperCase() : '?'

  const content = document.createElement('div')
  content.className = 'content'

  const nickEl = document.createElement('div')
  nickEl.className = 'nick'
  nickEl.textContent = data.nick

  const bubbleRow = document.createElement('div')
  bubbleRow.className = 'bubble-row'

  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = data.text
  bubble.title = '双击复制'
  bubble.addEventListener('dblclick', () => {
    navigator.clipboard && navigator.clipboard.writeText(data.text)
  })

  const time = document.createElement('div')
  time.className = 'time'
  const now = new Date()
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
  time.textContent = sameDay ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : (pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()))

  bubbleRow.appendChild(bubble)
  bubbleRow.appendChild(time)

  content.appendChild(nickEl)
  content.appendChild(bubbleRow)

  wrap.appendChild(avatar)
  wrap.appendChild(content)
  list.appendChild(wrap)
  list.scrollTop = list.scrollHeight
})
send.addEventListener('click', () => {
  const text = input.value.trim()
  if (!text) return
  ws.send(JSON.stringify({ nick, text }))
  input.value = ''
})
input.addEventListener('keydown', e => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
    e.preventDefault()
    send.click()
  }
})

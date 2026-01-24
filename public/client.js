const nick = localStorage.getItem('nick') || ('游客' + Math.floor(Math.random() * 1000))
localStorage.setItem('nick', nick)
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')
const input = document.getElementById('input')
const send = document.getElementById('send')
const list = document.getElementById('messages')
const counter = document.getElementById('counter')
send.disabled = true
input.addEventListener('input', () => {
  const t = input.value.trim()
  send.disabled = t.length === 0
  if (counter) counter.textContent = (t.length) + '/500'
})
ws.addEventListener('message', e => {
  let data
  try {
    data = JSON.parse(e.data)
  } catch (err) {
    return
  }
  const wrap = document.createElement('div')
  const self = data.nick === nick
  wrap.className = 'msg ' + (self ? 'self' : 'other')

  // Generate avatar
  const avatar = document.createElement('div')
  avatar.className = 'avatar'
  let hash = 0
  for (let i = 0; i < data.nick.length; i++) {
    hash = data.nick.charCodeAt(i) + ((hash << 5) - hash)
  }
  const c = (hash & 0x00FFFFFF).toString(16).toUpperCase()
  avatar.style.background = '#' + ('00000' + c).substr(-6)
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
  const ts = typeof data.ts === 'number' ? data.ts : Date.now()
  const d = new Date(ts)
  const pad = n => (n < 10 ? '0' + n : '' + n)
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
  if (e.key === 'Enter') {
    send.click()
  }
})

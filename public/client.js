const nick = localStorage.getItem('nick') || ('游客' + Math.floor(Math.random() * 1000))
localStorage.setItem('nick', nick)
const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws')
const input = document.getElementById('input')
const send = document.getElementById('send')
const list = document.getElementById('messages')
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
  const nickEl = document.createElement('div')
  nickEl.className = 'nick'
  nickEl.textContent = data.nick
  const bubble = document.createElement('div')
  bubble.className = 'bubble'
  bubble.textContent = data.text
  const time = document.createElement('div')
  time.className = 'time'
  time.textContent = data.time
  wrap.appendChild(nickEl)
  wrap.appendChild(bubble)
  wrap.appendChild(time)
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

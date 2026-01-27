const config = require('../../utils/config')
Page({
  data: {
    messages: [],
    inputValue: '',
    nick: '',
    lastId: '',
    connected: false,
    focus: false,
    counterLevel: ''
  },
  onLoad() {
    const stored = wx.getStorageSync('nick')
    const nick = stored || '游客' + Math.floor(Math.random() * 1000)
    wx.setStorageSync('nick', nick)
    this.setData({ nick })
    this.connect()
  },
  onUnload() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  },
  getAvatarColor(nick) {
    let hash = 0
    for (let i = 0; i < nick.length; i++) {
      hash = nick.charCodeAt(i) + ((hash << 5) - hash)
    }
    const c = (hash & 0x00FFFFFF).toString(16).toUpperCase()
    return '#' + ('00000' + c).substr(-6)
  },
  connect() {
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
    const socket = wx.connectSocket({ url: config.wsUrl })
    this.socket = socket
    this.setData({ connected: false })
    socket.onOpen(() => {
      this.setData({ connected: true })
    })
    socket.onMessage(res => {
      let msg
      try {
        msg = JSON.parse(res.data)
      } catch (e) {
        return
      }
      const self = msg.nick === this.data.nick
      const id = msg.id || Date.now().toString(36)
      const avatarColor = this.getAvatarColor(msg.nick)
      const avatarChar = msg.nick[0] ? msg.nick[0].toUpperCase() : '?'
      const timeStr = this.formatTime(msg.ts) || msg.time
      const day = this.dayKey(msg.ts)
      let list = this.data.messages.slice()
      let lastDay = ''
      for (let i = list.length - 1; i >= 0; i--) {
        const it = list[i]
        if (it && it.type !== 'sep') {
          lastDay = this.dayKey(it.ts)
          break
        }
      }
      if (day && day !== lastDay) {
        const sepId = 'sep-' + day
        list.push({ id: sepId, type: 'sep', label: day })
      }
      list.push({ id, nick: msg.nick, text: msg.text, time: timeStr, self, avatarColor, avatarChar, ts: msg.ts })
      if (list.length > 200) {
        list = list.slice(list.length - 200)
      }
      this.setData({
        messages: list,
        lastId: 'msg-' + id
      })
    })
    socket.onClose(() => {
      this.setData({ connected: false })
      this.scheduleReconnect()
    })
    socket.onError(() => {
      this.setData({ connected: false })
      this.scheduleReconnect()
    })
  },
  scheduleReconnect() {
    if (this._reconnectTimer) return
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this.connect()
    }, 2000)
  },
  onInput(e) {
    const v = e.detail.value || ''
    let level = ''
    const len = v.length
    if (len > 490) level = 'danger'
    else if (len > 400) level = 'warn'
    this.setData({ inputValue: v, counterLevel: level })
  },
  onSend() {
    const text = this.data.inputValue.trim()
    if (!text) return
    if (!this.socket || !this.data.connected) {
      wx.showToast({ title: '正在连接...', icon: 'none' })
      return
    }
    const payload = JSON.stringify({ nick: this.data.nick, text })
    this.socket.send({ data: payload })
    this.setData({ inputValue: '', focus: true })
    if (wx.vibrateShort) wx.vibrateShort()
  },
  formatTime(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const now = new Date()
    const pad = n => (n < 10 ? '0' + n : '' + n)
    const isSameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate()
    if (isSameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes())
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes())
  },
  dayKey(ts) {
    if (!ts) return ''
    const d = new Date(ts)
    const pad = n => (n < 10 ? '0' + n : '' + n)
    return pad(d.getMonth() + 1) + '-' + pad(d.getDate())
  },
  onCopy(e) {
    const text = e.currentTarget.dataset.text || ''
    if (!text) return
    wx.setClipboardData({ data: text })
    wx.showToast({ title: '已复制', icon: 'none' })
  },
  scrollToBottom() {
    const list = this.data.messages
    if (!list || !list.length) return
    const last = list[list.length - 1]
    this.setData({ lastId: 'msg-' + last.id })
  }
})

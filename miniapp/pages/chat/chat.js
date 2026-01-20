const config = require('../../utils/config')
Page({
  data: {
    messages: [],
    inputValue: '',
    nick: '',
    lastId: '',
    connected: false
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
      // Generate avatar props
      const avatarColor = this.getAvatarColor(msg.nick)
      const avatarChar = msg.nick[0] ? msg.nick[0].toUpperCase() : '?'
      
      const item = { id, nick: msg.nick, text: msg.text, time: msg.time, self, avatarColor, avatarChar }
      const list = this.data.messages.concat(item)
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
    this.setData({ inputValue: e.detail.value })
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
    this.setData({ inputValue: '' })
  }
})

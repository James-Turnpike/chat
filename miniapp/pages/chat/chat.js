const config = require('../../utils/config')
Page({
  data: {
    messages: [],
    inputValue: '',
    nick: '',
    scrollTop: 0
  },
  onLoad() {
    const stored = wx.getStorageSync('nick')
    const nick = stored || ('游客' + Math.floor(Math.random() * 1000))
    wx.setStorageSync('nick', nick)
    this.setData({ nick })
    this.connect()
  },
  connect() {
    const socket = wx.connectSocket({ url: config.wsUrl })
    this.socket = socket
    socket.onOpen(() => {})
    socket.onMessage(res => {
      try {
        const msg = JSON.parse(res.data)
        const self = msg.nick === this.data.nick
        const item = { id: msg.id, nick: msg.nick, text: msg.text, time: msg.time, self }
        const list = this.data.messages.concat(item)
        this.setData({ messages: list, scrollTop: list.length * 100 })
      } catch (e) {}
    })
    socket.onClose(() => {})
    socket.onError(() => {})
  },
  onInput(e) {
    this.setData({ inputValue: e.detail.value })
  },
  onSend() {
    const text = this.data.inputValue.trim()
    if (!text) return
    if (!this.socket) return
    const payload = JSON.stringify({ nick: this.data.nick, text })
    this.socket.send({ data: payload })
    this.setData({ inputValue: '' })
  }
})

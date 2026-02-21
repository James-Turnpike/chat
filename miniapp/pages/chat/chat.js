const config = require('../../utils/config')
const MAX_MSG = 200
const LENGTH_LIMIT = 500
const WARN_THRESHOLD = 400
const DANGER_THRESHOLD = 490
const PING_INTERVAL = 30000
const TOAST_THROTTLE = 5000
const HISTORY_DEBOUNCE = 300
const COLOR_SAVE_DEBOUNCE = 500
const COLOR_CACHE_MAX = 256
const META_CACHE_MAX = 256
const RECONNECT_BASE = 2000
const RECONNECT_MAX = 30000
const BATCH_WINDOW = 30
Page({
  data: {
    messages: [],
    inputValue: '',
    nick: '',
    lastId: '',
    connected: false,
    focus: false,
    counterLevel: '',
    nearBottom: true
  },
  onLoad() {
    this.loadColorCache()
    const stored = wx.getStorageSync('nick')
    const nick = stored || '游客' + Math.floor(Math.random() * 1000)
    wx.setStorageSync('nick', nick)
    this.setData({ nick })
    this._ids = {}
    this._avatarMetaCache = {}
    this._avatarMetaOrder = []
    this._colorOrder = []
    this._batchQueue = []
    this._batchTimer = null
    this._reconnectDelay = RECONNECT_BASE
    this.loadHistory()
    this.connect()
    wx.onNetworkStatusChange && wx.onNetworkStatusChange(res => {
      const online = !!(res && res.isConnected)
      this._netOnline = online
      if (!online) {
        this.setData({ connected: false })
        if (this._pingTimer) {
          clearInterval(this._pingTimer)
          this._pingTimer = null
        }
        if (this._reconnectTimer) {
          clearTimeout(this._reconnectTimer)
          this._reconnectTimer = null
        }
      } else {
        this._reconnectDelay = RECONNECT_BASE
        if (!this.data.connected) this.scheduleReconnect()
      }
    })
  },
  onUnload() {
    if (this._reconnectTimer) {
      clearTimeout(this._reconnectTimer)
      this._reconnectTimer = null
    }
    if (this._pingTimer) {
      clearInterval(this._pingTimer)
      this._pingTimer = null
    }
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    if (this._pendingHistory && Array.isArray(this._pendingHistory)) {
      this.saveHistory(this._pendingHistory)
      this._pendingHistory = null
    }
    if (this._colorSaveTimer) {
      clearTimeout(this._colorSaveTimer)
      this._colorSaveTimer = null
    }
    if (this._batchTimer) {
      clearTimeout(this._batchTimer)
      this._batchTimer = null
    }
    if (this.socket) {
      this.socket.close()
      this.socket = null
    }
  },
  onHide() {
    if (this._pingTimer) {
      clearInterval(this._pingTimer)
      this._pingTimer = null
    }
  },
  onShow() {
    if (this.data && this.data.connected) {
      if (!this._pingTimer) {
        this._pingTimer = setInterval(() => {
          try {
            this.socket && this.socket.send({ data: '{"type":"ping"}' })
          } catch (e) {}
        }, PING_INTERVAL)
      }
    } else {
      this.scheduleReconnect()
    }
  },
  onScroll(e) {
    const dy = e && e.detail && typeof e.detail.deltaY === 'number' ? e.detail.deltaY : 0
    if (dy < 0 && this.data.nearBottom) {
      this.setData({ nearBottom: false })
    }
  },
  onScrollToLower() {
    if (!this.data.nearBottom) {
      this.setData({ nearBottom: true })
    }
  },
  shouldAutoScroll() {
    return !!this.data.nearBottom
  },
  getAvatarColor(nick) {
    const key = ((nick || '').trim().toLowerCase()) || '游客'
    if (!this._colorCache) this._colorCache = {}
    if (this._colorCache[key]) return this._colorCache[key]
    let hash = 0
    for (let i = 0; i < key.length; i++) {
      hash = key.charCodeAt(i) + ((hash << 5) - hash)
    }
    const hue = Math.abs(hash) % 360
    const color = this.hslToHex(hue, 45, 78)
    this._colorCache[key] = color
    const idx = this._colorOrder.indexOf(key)
    if (idx >= 0) this._colorOrder.splice(idx, 1)
    this._colorOrder.push(key)
    if (this._colorOrder.length > COLOR_CACHE_MAX) {
      const oldKey = this._colorOrder.shift()
      if (oldKey) delete this._colorCache[oldKey]
    }
    this.scheduleSaveColorCache()
    return color
  },
  getAvatarTextColor(hex) {
    const { r, g, b } = this.hexToRgb(hex)
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
    return luminance > 0.68 ? '#1a1a1a' : '#ffffff'
  },
  getAvatarMeta(nick) {
    const key = ((nick || '').trim().toLowerCase()) || '游客'
    if (!this._avatarMetaCache) this._avatarMetaCache = {}
    const cached = this._avatarMetaCache[key]
    if (cached) return cached
    const color = this.getAvatarColor(nick)
    const textColor = this.getAvatarTextColor(color)
    const char = (nick && nick[0]) ? nick[0].toUpperCase() : '?'
    const meta = { color, textColor, char }
    this._avatarMetaCache[key] = meta
    const idx = this._avatarMetaOrder.indexOf(key)
    if (idx >= 0) this._avatarMetaOrder.splice(idx, 1)
    this._avatarMetaOrder.push(key)
    if (this._avatarMetaOrder.length > META_CACHE_MAX) {
      const oldKey = this._avatarMetaOrder.shift()
      if (oldKey) delete this._avatarMetaCache[oldKey]
    }
    return meta
  },
  hexToRgb(hex) {
    const h = hex.replace('#', '')
    const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
    return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
  },
  loadColorCache() {
    try {
      const cache = wx.getStorageSync('colorCache')
      this._colorCache = cache && typeof cache === 'object' ? cache : {}
    } catch (e) {
      this._colorCache = {}
    }
  },
  saveColorCache() {
    try {
      wx.setStorageSync('colorCache', this._colorCache)
    } catch (e) {}
  },
  scheduleSaveColorCache() {
    if (this._colorSaveTimer) {
      clearTimeout(this._colorSaveTimer)
    }
    this._colorSaveTimer = setTimeout(() => {
      this._colorSaveTimer = null
      this.saveColorCache()
    }, COLOR_SAVE_DEBOUNCE)
  },
  hslToHex(h, s, l) {
    s /= 100
    l /= 100
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
    const toHex = v => {
      const hv = Math.round((v + m) * 255).toString(16).padStart(2, '0')
      return hv
    }
    return '#' + toHex(r) + toHex(g) + toHex(b)
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
      this.setData({ connected: true, focus: true })
      const now = Date.now()
      if (!this._lastToastAt || now - this._lastToastAt > TOAST_THROTTLE) {
        wx.showToast({ title: '已连接', icon: 'none' })
        this._lastToastAt = now
      }
      this._reconnectDelay = RECONNECT_BASE
      if (this._pingTimer) clearInterval(this._pingTimer)
      this._pingTimer = setInterval(() => {
        try {
          this.socket && this.socket.send({ data: '{"type":"ping"}' })
        } catch (e) {}
      }, PING_INTERVAL)
    })
    socket.onMessage(res => {
      let msg
      try {
        msg = JSON.parse(res.data)
      } catch (e) {
        return
      }
      if (!msg || typeof msg.text !== 'string' || !msg.nick) return
      const self = msg.nick === this.data.nick
      const id = msg.id || Date.now().toString(36)
      if (this._ids && this._ids[id]) return
      const meta = this.getAvatarMeta(msg.nick)
      const avatarColor = meta.color
      const avatarTextColor = meta.textColor
      const avatarChar = meta.char
      const timeStr = this.formatTime(msg.ts) || msg.time
      const day = this.dayKey(msg.ts)
      const lastDay = this._lastMsgDay || ''
      const entries = []
      if (day && day !== lastDay) {
        entries.push({ id: 'sep-' + day, type: 'sep', label: day })
      }
      entries.push({ id, nick: msg.nick, text: msg.text, time: timeStr, self, avatarColor, avatarTextColor, avatarChar, ts: msg.ts })
      if (this._ids) this._ids[id] = true
      if (!this._batchQueue) this._batchQueue = []
      this._batchQueue.push.apply(this._batchQueue, entries)
      this.scheduleFlush('msg-' + id, day)
    })
    socket.onClose(() => {
      this.setData({ connected: false })
      if (this._pingTimer) {
        clearInterval(this._pingTimer)
        this._pingTimer = null
      }
      this.scheduleReconnect()
    })
    socket.onError(() => {
      this.setData({ connected: false })
      if (this._pingTimer) {
        clearInterval(this._pingTimer)
        this._pingTimer = null
      }
      this.scheduleReconnect()
    })
  },
  scheduleReconnect() {
    if (this._reconnectTimer) return
    const base = this._reconnectDelay || 2000
    const jitter = base * (0.8 + Math.random() * 0.4)
    this._reconnectTimer = setTimeout(() => {
      this._reconnectTimer = null
      this.connect()
      const next = Math.min(Math.round(base * 1.5), RECONNECT_MAX)
      this._reconnectDelay = next
    }, Math.round(jitter))
  },
  onInput(e) {
    const v = e.detail.value || ''
    let level = ''
    const len = v.length
    if (len > DANGER_THRESHOLD) level = 'danger'
    else if (len > WARN_THRESHOLD) level = 'warn'
    if (v === this.data.inputValue && level === this.data.counterLevel) return
    this.setData({ inputValue: v, counterLevel: level })
  },
  onSend() {
    const text = this.data.inputValue.trim()
    if (!text) return
    if (text.length > LENGTH_LIMIT) {
      wx.showToast({ title: '内容过长', icon: 'none' })
      return
    }
    if (!this.socket || !this.data.connected) {
      const now = Date.now()
      if (!this._lastConnectToastAt || now - this._lastConnectToastAt > TOAST_THROTTLE) {
        wx.showToast({ title: '正在连接...', icon: 'none' })
        this._lastConnectToastAt = now
      }
      return
    }
    const payload = JSON.stringify({ nick: this.data.nick, text })
    try {
      this.socket.send({ data: payload })
    } catch (e) {
      const now = Date.now()
      if (!this._lastConnectToastAt || now - this._lastConnectToastAt > TOAST_THROTTLE) {
        wx.showToast({ title: '正在连接...', icon: 'none' })
        this._lastConnectToastAt = now
      }
      this.scheduleReconnect()
      return
    }
    this.setData({ inputValue: '', focus: true, counterLevel: '' })
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
  loadHistory() {
    try {
      const list = wx.getStorageSync('messages')
      if (Array.isArray(list) && list.length) {
        const last = list[list.length - 1]
        this.setData({ messages: list, lastId: last && last.id ? ('msg-' + last.id) : '' })
        if (!this._ids) this._ids = {}
        for (let i = 0; i < list.length; i++) {
          const it = list[i]
          if (it && it.id && it.type !== 'sep') this._ids[it.id] = true
        }
        let d = ''
        for (let i = list.length - 1; i >= 0; i--) {
          const it = list[i]
          if (it && it.type !== 'sep') {
            d = this.dayKey(it.ts)
            break
          }
        }
        this._lastMsgDay = d
      }
    } catch (e) {}
  },
  saveHistory(list) {
    try {
      wx.setStorageSync('messages', list.slice(-MAX_MSG))
    } catch (e) {}
  },
  scheduleSaveHistory(list) {
    this._pendingHistory = list
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
    }
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      if (this._pendingHistory) {
        this.saveHistory(this._pendingHistory)
        this._pendingHistory = null
      }
    }, HISTORY_DEBOUNCE)
  },
  appendMessages(entries, lastId) {
    const base = (this.data.messages && this.data.messages.length) || 0
    const patch = {}
    for (let i = 0; i < entries.length; i++) {
      patch['messages[' + (base + i) + ']'] = entries[i]
    }
    if (lastId && this.shouldAutoScroll() && this.data.lastId !== lastId) {
      patch.lastId = lastId
    }
    this.setData(patch)
  },
  scheduleFlush(lastId, day) {
    if (this._batchTimer) return
    this._nextLastId = lastId
    this._nextDay = day
    this._batchTimer = setTimeout(() => {
      this._batchTimer = null
      this.flushMessages()
    }, BATCH_WINDOW)
  },
  flushMessages() {
    const queue = this._batchQueue || []
    if (!queue.length) return
    this._batchQueue = []
    const current = this.data.messages || []
    let combined = current.concat(queue)
    combined = this.dedupSeps(combined)
    if (combined.length <= MAX_MSG) {
      const base = current.length
      const patch = {}
      for (let i = 0; i < combined.length - base; i++) {
        patch['messages[' + (base + i) + ']'] = combined[base + i]
      }
      const lastId = this._nextLastId
      if (lastId && this.shouldAutoScroll() && this.data.lastId !== lastId) patch.lastId = lastId
      this.setData(patch)
      this._lastMsgDay = this._nextDay || this._lastMsgDay
      this.scheduleSaveHistory(combined)
    } else {
      const trimmed = combined.slice(combined.length - MAX_MSG)
      if (this._ids) {
        const map = {}
        for (let i = 0; i < trimmed.length; i++) {
          const it = trimmed[i]
          if (it && it.id && it.type !== 'sep') map[it.id] = true
        }
        this._ids = map
      }
      let d = ''
      for (let i = trimmed.length - 1; i >= 0; i--) {
        const it = trimmed[i]
        if (it && it.type !== 'sep') {
          d = this.dayKey(it.ts)
          break
        }
      }
      this._lastMsgDay = d
      const lastId = this._nextLastId
      const dataObj = this.shouldAutoScroll() && lastId && this.data.lastId !== lastId ? { messages: trimmed, lastId } : { messages: trimmed }
      this.setData(dataObj)
      this.scheduleSaveHistory(trimmed)
    }
    this._nextLastId = ''
    this._nextDay = ''
  },
  dedupSeps(list) {
    const out = []
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      if (!it || it.type !== 'sep') {
        out.push(it)
        continue
      }
      const prev = out[out.length - 1]
      if (!prev || prev.type !== 'sep' || prev.label !== it.label) {
        out.push(it)
      }
    }
    while (out.length && out[0] && out[0].type === 'sep') out.shift()
    while (out.length && out[out.length - 1] && out[out.length - 1].type === 'sep') out.pop()
    return out
  },
  onCopy(e) {
    const text = e.currentTarget.dataset.text || ''
    if (!text) return
    wx.setClipboardData({ data: text })
    wx.showToast({ title: '已复制', icon: 'none' })
    if (wx.vibrateShort) wx.vibrateShort()
  },
  scrollToBottom() {
    const list = this.data.messages
    if (!list || !list.length) return
    const last = list[list.length - 1]
    const id = 'msg-' + last.id
    if (this.data.lastId === id) return
    this.setData({ lastId: id })
  },
  onFocusInput() {
    this.scrollToBottom()
  },
  onClear() {
    this._ids = {}
    this.setData({ messages: [], lastId: '', inputValue: '', focus: true })
    try { wx.removeStorageSync('messages') } catch (e) {}
    if (this._saveTimer) {
      clearTimeout(this._saveTimer)
      this._saveTimer = null
    }
    this._pendingHistory = null
    this._lastMsgDay = ''
  }
})

const config = require('../../utils/config')
const { getAvatarColor, getAvatarTextColor } = require('../../utils/color')
const { formatTime } = require('../../utils/format')

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
const SCROLL_THROTTLE = 100
const LARGE_BATCH = 40

Page({
  data: {
    messages: [],
    inputValue: '',
    nick: '',
    lastId: '',
    connected: false,
    focus: false,
    counterLevel: '',
    nearBottom: true,
    showToBottom: false,
    unreadCount: 0,
    scrollAnim: false
  },

  // 私有变量
  _ids: {},
  _avatarMetaCache: {},
  _avatarMetaOrder: [],
  _colorCache: {},
  _colorOrder: [],
  _batchQueue: [],
  _batchTimer: null,
  _reconnectDelay: RECONNECT_BASE,
  _lastScrollTop: 0,
  _lastScrollAt: 0,
  _lastMsgDay: '',
  _sharedDate: new Date(),

  onLoad() {
    this.loadColorCache()
    const stored = wx.getStorageSync('nick')
    const nick = stored || `游客${Math.floor(Math.random() * 1000)}`
    if (!stored) wx.setStorageSync('nick', nick)
    this.setData({ nick })
    
    this.loadHistory()
    this.connect()
    this.initNetworkListener()
  },

  initNetworkListener() {
    if (!wx.onNetworkStatusChange) return
    this._onNetworkChange = (res) => {
      const online = !!(res && res.isConnected)
      this._netOnline = online
      if (!online) {
        this.setData({ connected: false })
        this.stopTimers()
      } else {
        this._reconnectDelay = RECONNECT_BASE
        if (!this.data.connected) this.scheduleReconnect()
      }
    }
    wx.onNetworkStatusChange(this._onNetworkChange)
  },

  stopTimers() {
    [this._pingTimer, this._reconnectTimer, this._saveTimer, this._colorSaveTimer, this._batchTimer].forEach(timer => {
      if (timer) {
        clearTimeout(timer)
        clearInterval(timer)
      }
    })
    this._pingTimer = this._reconnectTimer = this._saveTimer = this._colorSaveTimer = this._batchTimer = null
  },

  onUnload() {
    this.stopTimers()
    if (this._onNetworkChange && wx.offNetworkStatusChange) {
      wx.offNetworkStatusChange(this._onNetworkChange)
    }
    
    if (this._pendingHistory) {
      this.saveHistory(this._pendingHistory)
      this._pendingHistory = null
    }

    if (this.socket) {
      this.socket.close({ code: 1000, reason: 'page unload' })
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
    if (this.data.connected) {
      this.startPing()
    } else {
      this.scheduleReconnect()
    }
  },

  startPing() {
    if (this._pingTimer) return
    this._pingTimer = setInterval(() => {
      try {
        if (this.socket && this.data.connected) {
          this.socket.send({ data: '{"type":"ping"}' })
        }
      } catch (e) {}
    }, PING_INTERVAL)
  },

  onScroll(e) {
    const st = e.detail.scrollTop || 0
    const now = Date.now()
    if (now - this._lastScrollAt < SCROLL_THROTTLE) return
    
    const isScrollingUp = this._lastScrollTop - st > 20
    if (isScrollingUp && this.data.nearBottom) {
      this.setData({ nearBottom: false })
    }
    
    this._lastScrollAt = now
    this._lastScrollTop = st
  },

  onScrollToLower() {
    if (!this.data.nearBottom) {
      this.setData({ 
        nearBottom: true, 
        showToBottom: false, 
        unreadCount: 0 
      })
    }
  },

  shouldAutoScroll() {
    return this.data.nearBottom
  },

  getAvatarMeta(nick) {
    const key = ((nick || '').trim().toLowerCase()) || '游客'
    if (this._avatarMetaCache[key]) return this._avatarMetaCache[key]

    const color = this.getCachedAvatarColor(key)
    const textColor = getAvatarTextColor(color)
    const char = (nick && nick[0]) ? nick[0].toUpperCase() : '?'
    const meta = { color, textColor, char }
    
    this._avatarMetaCache[key] = meta
    this._updateCacheOrder(this._avatarMetaOrder, key, META_CACHE_MAX, this._avatarMetaCache)
    
    return meta
  },

  getCachedAvatarColor(key) {
    if (this._colorCache[key]) return this._colorCache[key]
    const color = getAvatarColor(key)
    this._colorCache[key] = color
    this._updateCacheOrder(this._colorOrder, key, COLOR_CACHE_MAX, this._colorCache)
    this.scheduleSaveColorCache()
    return color
  },

  _updateCacheOrder(orderArray, key, maxSize, cacheObject) {
    const idx = orderArray.indexOf(key)
    if (idx >= 0) orderArray.splice(idx, 1)
    orderArray.push(key)
    if (orderArray.length > maxSize) {
      const oldKey = orderArray.shift()
      if (oldKey && cacheObject) delete cacheObject[oldKey]
    }
  },

  loadColorCache() {
    try {
      const cache = wx.getStorageSync('colorCache')
      this._colorCache = cache || {}
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
    if (this._colorSaveTimer) clearTimeout(this._colorSaveTimer)
    this._colorSaveTimer = setTimeout(() => {
      this._colorSaveTimer = null
      this.saveColorCache()
    }, COLOR_SAVE_DEBOUNCE)
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
      this.showConnectedToast()
      this._reconnectDelay = RECONNECT_BASE
      this.startPing()
    })

    socket.onMessage(res => {
      this.handleSocketMessage(res.data)
    })

    const onDisconnect = (res) => {
      this.setData({ connected: false })
      this.stopTimers()
      this.scheduleReconnect()
      if (res && res.errMsg && !res.errMsg.includes('page unload')) {
        console.error('[Socket] Disconnected:', res)
      }
    }

    socket.onClose(onDisconnect)
    socket.onError(onDisconnect)
  },

  showConnectedToast() {
    const now = Date.now()
    if (!this._lastToastAt || now - this._lastToastAt > TOAST_THROTTLE) {
      wx.showToast({ title: '已连接', icon: 'none' })
      this._lastToastAt = now
    }
  },

  handleSocketMessage(data) {
    let msg
    try {
      msg = JSON.parse(data)
    } catch (e) {
      console.error('[Socket] Parse Error:', e)
      return
    }

    if (!msg || typeof msg.text !== 'string' || !msg.nick) return
    if (msg.type === 'ping') return

    const id = msg.id || Date.now().toString(36)
    if (this._ids[id]) return

    const self = msg.nick === this.data.nick
    const meta = this.getAvatarMeta(msg.nick)
    
    const ts = msg.ts || Date.now()
    this._sharedDate.setTime(ts)
    const timeStr = formatTime(this._sharedDate)
    const day = this.getDayKey(ts)
    
    const entries = []
    if (day && day !== this._lastMsgDay) {
      entries.push({ id: `sep-${day}`, type: 'sep', label: day })
      this._lastMsgDay = day 
    }
    
    entries.push({
      id,
      nick: msg.nick,
      text: msg.text,
      time: timeStr,
      self,
      avatarColor: meta.color,
      avatarTextColor: meta.textColor,
      avatarChar: meta.char,
      ts: ts
    })

    this._ids[id] = true
    this._batchQueue.push(...entries)
    this.scheduleFlush(`msg-${id}`, day)
  },

  getDayKey(ts) {
    if (!ts) return ''
    this._sharedDate.setTime(ts)
    const m = (this._sharedDate.getMonth() + 1).toString().padStart(2, '0')
    const day = this._sharedDate.getDate().toString().padStart(2, '0')
    return `${m}-${day}`
  },

  scheduleReconnect() {
    if (this._reconnectTimer) return
    const base = this._reconnectDelay || RECONNECT_BASE
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
    const len = v.length
    let level = ''
    if (len > DANGER_THRESHOLD) level = 'danger'
    else if (len > WARN_THRESHOLD) level = 'warn'
    
    // 只有在值或状态发生变化时才更新，减少 setData
    if (v === this.data.inputValue && level === this.data.counterLevel) return
    
    const patch = { inputValue: v, counterLevel: level }
    this.setData(patch)
  },

  onSend() {
    const text = this.data.inputValue.trim()
    if (!text) return
    
    if (text.length > LENGTH_LIMIT) {
      wx.showToast({ title: '内容过长', icon: 'none' })
      return
    }

    if (!this.socket || !this.data.connected) {
      this.showConnectingToast()
      return
    }

    const payload = JSON.stringify({ nick: this.data.nick, text })
    try {
      this.socket.send({ 
        data: payload,
        fail: (err) => {
          console.error('[Socket] Send Failed:', err)
          this.showConnectingToast()
          this.scheduleReconnect()
        }
      })
    } catch (e) {
      console.error('[Socket] Send Error:', e)
      this.showConnectingToast()
      this.scheduleReconnect()
      return
    }

    this.setData({ inputValue: '', focus: true, counterLevel: '' })
    if (wx.vibrateShort) wx.vibrateShort()
  },

  showConnectingToast() {
    const now = Date.now()
    if (!this._lastConnectToastAt || now - this._lastConnectToastAt > TOAST_THROTTLE) {
      wx.showToast({ title: '正在连接...', icon: 'none' })
      this._lastConnectToastAt = now
    }
  },

  loadHistory() {
    try {
      const list = wx.getStorageSync('messages')
      if (!Array.isArray(list) || !list.length) return

      const lastMsg = list.slice().reverse().find(it => it.type !== 'sep')
      const lastId = lastMsg ? 'msg-' + lastMsg.id : ''
      
      this.setData({ messages: list, lastId })
      
      this._ids = {}
      list.forEach(it => {
        if (it.id && it.type !== 'sep') this._ids[it.id] = true
      })
      
      this._lastMsgDay = lastMsg ? this.getDayKey(lastMsg.ts) : ''
    } catch (e) {}
  },

  saveHistory(list) {
    try {
      wx.setStorageSync('messages', list.slice(-MAX_MSG))
    } catch (e) {}
  },

  scheduleSaveHistory(list) {
    this._pendingHistory = list
    if (this._saveTimer) clearTimeout(this._saveTimer)
    this._saveTimer = setTimeout(() => {
      this._saveTimer = null
      if (this._pendingHistory) {
        this.saveHistory(this._pendingHistory)
        this._pendingHistory = null
      }
    }, HISTORY_DEBOUNCE)
  },

  scheduleFlush(lastId, day) {
    this._nextLastId = lastId
    this._nextDay = day
    if (!this._batchTimer) {
      this._batchTimer = setTimeout(() => {
        this._batchTimer = null
        this.flushMessages()
      }, BATCH_WINDOW)
    }
  },

  flushMessages() {
    const queue = this._batchQueue
    if (!queue.length) return
    
    this._batchQueue = []
    const currentMessages = this.data.messages
    
    // 检查是否有重复的分隔符（当新批次的第一个是分隔符且与列表中最后一个相同）
    const lastItem = currentMessages[currentMessages.length - 1]
    let filteredQueue = queue
    if (lastItem?.type === 'sep' && queue[0]?.type === 'sep' && lastItem.label === queue[0].label) {
      filteredQueue = queue.slice(1)
    }
    
    let combined = [...currentMessages, ...filteredQueue]
    const addedCount = filteredQueue.filter(it => it.type !== 'sep').length

    // 限制最大消息数
    if (combined.length > MAX_MSG) {
      combined = combined.slice(-MAX_MSG)
      combined = this.dedupSeps(combined)
      this._rebuildIdsMap(combined)
    }

    const lastMsg = [...combined].reverse().find(it => it.type !== 'sep')
    this._lastMsgDay = lastMsg ? this.getDayKey(lastMsg.ts) : this._lastMsgDay

    const patch = this._buildMessagePatch(currentMessages, combined, addedCount)
    this.setData(patch)
    this.scheduleSaveHistory(combined)
  },

  _rebuildIdsMap(list) {
    this._ids = {}
    list.forEach(it => {
      if (it.id && it.type !== 'sep') this._ids[it.id] = true
    })
  },

  _buildMessagePatch(oldList, newList, addedCount) {
    const patch = {}
    const diff = newList.length - oldList.length
    
    // 如果是截断（长度减少）或者大批量更新，全量更新 messages
    if (diff <= 0 || diff > LARGE_BATCH) {
      patch.messages = newList
    } else {
      // 增量更新，利用小程序 setData 的索引更新特性
      for (let i = oldList.length; i < newList.length; i++) {
        patch[`messages[${i}]`] = newList[i]
      }
    }

    const lastId = this._nextLastId
    const shouldScroll = this.shouldAutoScroll()

    if (lastId && shouldScroll && this.data.lastId !== lastId) {
      patch.lastId = lastId
      patch.scrollAnim = false
    }

    if (!shouldScroll) {
      patch.showToBottom = true
      patch.unreadCount = (this.data.unreadCount || 0) + addedCount
    }

    return patch
  },

  dedupSeps(list) {
    const result = []
    let lastSep = null
    for (let i = 0; i < list.length; i++) {
      const it = list[i]
      if (it.type === 'sep') {
        if (lastSep && lastSep.label === it.label) continue
        lastSep = it
      } else {
        lastSep = null
      }
      result.push(it)
    }
    return result
  },

  onClear() {
    wx.showModal({
      title: '提示',
      content: '确定清空所有消息吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({ messages: [], lastId: '', unreadCount: 0, showToBottom: false })
          this._ids = {}
          this._lastMsgDay = ''
          wx.removeStorageSync('messages')
        }
      }
    })
  },

  onCopy(e) {
    const text = e.currentTarget.dataset.text
    if (text) {
      wx.setClipboardData({
        data: text,
        success: () => wx.showToast({ title: '已复制', icon: 'none' })
      })
    }
  },

  scrollToBottom() {
    const lastMsg = this.data.messages.slice().reverse().find(it => it.type !== 'sep')
    if (lastMsg) {
      this.setData({ 
        lastId: 'msg-' + lastMsg.id, 
        scrollAnim: true,
        nearBottom: true,
        showToBottom: false,
        unreadCount: 0
      })
    }
  },

  onFocusInput() {
    if (this.shouldAutoScroll()) {
      setTimeout(() => this.scrollToBottom(), 300)
    }
  }
})

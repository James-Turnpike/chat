
function hexToRgb(hex) {
  const h = hex.replace('#', '')
  const bigint = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return { r: (bigint >> 16) & 255, g: (bigint >> 8) & 255, b: bigint & 255 }
}

function hslToHex(h, s, l) {
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
}

function getAvatarTextColor(hex) {
  const { r, g, b } = hexToRgb(hex)
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return luminance > 0.68 ? '#1a1a1a' : '#ffffff'
}

function getAvatarColor(nick) {
  const key = ((nick || '').trim().toLowerCase()) || '游客'
  let hash = 0
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash)
  }
  const hue = Math.abs(hash) % 360
  return hslToHex(hue, 45, 78)
}

module.exports = {
  hexToRgb,
  hslToHex,
  getAvatarTextColor,
  getAvatarColor
}

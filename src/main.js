import QRCode from 'https://esm.sh/qrcode@1.5.4'

const $ = (id) => document.getElementById(id)

const els = {
  fileInput: $('fileInput'),
  dropzone: $('dropzone'),
  fileCard: $('fileCard'),
  fileName: $('fileName'),
  fileMeta: $('fileMeta'),
  clearButton: $('clearButton'),
  chunkSize: $('chunkSize'),
  fps: $('fps'),
  compress: $('compress'),
  prepareButton: $('prepareButton'),
  startButton: $('startButton'),
  pauseButton: $('pauseButton'),
  setupButton: $('setupButton'),
  progressBar: $('progressBar'),
  progressText: $('progressText'),
  qrCanvas: $('qrCanvas'),
  frameTitle: $('frameTitle'),
  frameSubtitle: $('frameSubtitle'),
  statusPill: $('statusPill'),
}

const MAX_FILE_SIZE = 100 * 1024 * 1024
const MAX_CHUNKS = 200_000
let selectedFile = null
let setupPayload = null
let frames = []
let frameIndex = 0
let loops = 0
let timer = null
let transferID = ''
let preparedMeta = null

loadSettingsFromHash()
writeSettingsToHash()
renderEmptyQR()

for (const input of [els.chunkSize, els.fps, els.compress]) {
  input.addEventListener('input', writeSettingsToHash)
  input.addEventListener('change', writeSettingsToHash)
}

els.fileInput.addEventListener('change', () => {
  const file = els.fileInput.files?.[0]
  if (file) setFile(file)
})

els.dropzone.addEventListener('click', (event) => {
  if (event.target !== els.fileInput) els.fileInput.click()
})
els.dropzone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    els.fileInput.click()
  }
})

els.dropzone.addEventListener('dragover', (event) => {
  event.preventDefault()
  els.dropzone.classList.add('drag')
})
els.dropzone.addEventListener('dragleave', () => els.dropzone.classList.remove('drag'))
els.dropzone.addEventListener('drop', (event) => {
  event.preventDefault()
  els.dropzone.classList.remove('drag')
  const file = event.dataTransfer?.files?.[0]
  if (file) setFile(file)
})

els.clearButton.addEventListener('click', clearFile)
els.prepareButton.addEventListener('click', prepare)
els.startButton.addEventListener('click', start)
els.pauseButton.addEventListener('click', pause)
els.setupButton.addEventListener('click', showSetup)

function loadSettingsFromHash() {
  const params = new URLSearchParams(location.hash.replace(/^#/, ''))
  if (params.get('chunkSize')) els.chunkSize.value = params.get('chunkSize')
  if (params.get('fps')) els.fps.value = params.get('fps')
  if (params.get('compress')) els.compress.checked = params.get('compress') !== '0'
}

function writeSettingsToHash() {
  const params = new URLSearchParams()
  params.set('chunkSize', String(chunkSize()))
  params.set('fps', String(fps()))
  params.set('compress', els.compress.checked ? '1' : '0')
  history.replaceState(null, '', `#${params.toString()}`)
}

function setFile(file) {
  selectedFile = file
  pause()
  setupPayload = null
  frames = []
  frameIndex = 0
  loops = 0
  preparedMeta = null
  els.fileInput.value = ''
  els.fileName.textContent = file.name
  els.fileMeta.textContent = `${formatBytes(file.size)} · ${file.type || 'unknown type'}`
  els.fileCard.classList.remove('hidden')
  els.startButton.disabled = true
  els.pauseButton.disabled = true
  els.setupButton.disabled = true
  setStatus('File selected')
  setProgress(0, 'Press Prepare to build QR frames.')
  renderEmptyQR()
}

function clearFile() {
  pause()
  selectedFile = null
  setupPayload = null
  frames = []
  preparedMeta = null
  els.fileCard.classList.add('hidden')
  els.startButton.disabled = true
  els.pauseButton.disabled = true
  els.setupButton.disabled = true
  setStatus('Idle')
  setProgress(0, 'Pick a file to begin.')
  renderEmptyQR()
}

async function prepare() {
  try {
    if (!selectedFile) throw new Error('Choose a file first.')
    pause()
    setStatus('Preparing')
    setProgress(0, 'Reading file…')

    const original = new Uint8Array(await selectedFile.arrayBuffer())
    if (original.byteLength > MAX_FILE_SIZE) {
      throw new Error(`File is too large: ${formatBytes(original.byteLength)} > ${formatBytes(MAX_FILE_SIZE)}`)
    }

    let payload = original
    const originalHash = await sha256Hex(original)
    let compression = ''
    if (els.compress.checked && supportsCompressionStream()) {
      setProgress(0, 'Compressing with gzip…')
      const compressed = await gzip(original)
      if (compressed.byteLength < original.byteLength) {
        payload = compressed
        compression = 'gzip'
      }
    }

    const size = payload.byteLength
    const total = Math.max(1, Math.ceil(size / chunkSize()))
    if (total > MAX_CHUNKS) throw new Error(`Too many QR frames: ${total} > ${MAX_CHUNKS}. Increase chunk size or use a smaller file.`)

    transferID = randomHex(6)
    const fileHash = await sha256Hex(payload)
    const frameDelayMS = Math.round(1000 / fps())
    const setup = {
      v: 1,
      k: 'setup',
      id: transferID,
      n: selectedFile.name || 'file',
      s: size,
      t: total,
      f: fileHash,
      ms: frameDelayMS,
    }
    if (compression) {
      setup.c = compression
      setup.us = original.byteLength
      setup.uf = originalHash
    }

    const nextFrames = []
    for (let i = 0; i < total; i++) {
      const start = i * chunkSize()
      const end = Math.min(size, start + chunkSize())
      const chunk = payload.slice(start, end)
      nextFrames.push(JSON.stringify({
        v: 1,
        k: 'data',
        id: transferID,
        n: selectedFile.name || 'file',
        s: size,
        i,
        t: total,
        d: base64(chunk),
        h: await sha256Hex(chunk),
        f: fileHash,
      }))
      if (i % 25 === 0) setProgress(i / total, `Hashing chunks… ${i}/${total}`)
    }

    setupPayload = JSON.stringify(setup)
    frames = nextFrames
    frameIndex = 0
    loops = 0
    preparedMeta = { originalSize: original.byteLength, transferSize: size, compression, total }
    els.startButton.disabled = false
    els.setupButton.disabled = false
    els.pauseButton.disabled = true
    setStatus('Ready')
    showSetup()
  } catch (error) {
    console.error(error)
    setStatus('Error')
    setProgress(0, error.message || String(error))
  }
}

function start() {
  if (!frames.length) return
  pause()
  setStatus('Streaming')
  els.startButton.disabled = true
  els.pauseButton.disabled = false
  els.setupButton.disabled = false
  renderFrame()
  timer = setInterval(nextFrame, 1000 / fps())
}

function pause() {
  if (timer) clearInterval(timer)
  timer = null
  if (frames.length) {
    els.startButton.disabled = false
    els.pauseButton.disabled = true
    setStatus('Paused')
  }
}

function showSetup() {
  if (!setupPayload) return
  pause()
  drawQR(setupPayload)
  const suffix = preparedMeta?.compression ? ` · gzip ${formatBytes(preparedMeta.originalSize)} → ${formatBytes(preparedMeta.transferSize)}` : ''
  els.frameTitle.textContent = `${selectedFile.name} · SETUP QR`
  els.frameSubtitle.textContent = `Scan this first. Then press Start here when QRDrop says ready.${suffix}`
  setProgress(0, `${frames.length} data frames prepared.${suffix}`)
}

function nextFrame() {
  frameIndex++
  if (frameIndex >= frames.length) {
    frameIndex = 0
    loops++
  }
  renderFrame()
}

function renderFrame() {
  if (!frames.length) return
  drawQR(frames[frameIndex])
  const current = frameIndex + 1
  els.frameTitle.textContent = `${selectedFile.name} · frame ${current}/${frames.length}`
  els.frameSubtitle.textContent = `loop ${loops + 1} · ${fps().toFixed(1)} fps · ${chunkSize()} bytes/frame`
  setProgress(current / frames.length, `Streaming frame ${current}/${frames.length}, loop ${loops + 1}.`)
}

async function drawQR(payload) {
  await QRCode.toCanvas(els.qrCanvas, payload, {
    errorCorrectionLevel: 'L',
    margin: 2,
    scale: 8,
    color: { dark: '#081114', light: '#ffffff' },
  })
}

function renderEmptyQR() {
  const ctx = els.qrCanvas.getContext('2d')
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, els.qrCanvas.width, els.qrCanvas.height)
  ctx.fillStyle = '#081114'
  ctx.font = 'bold 42px system-ui'
  ctx.textAlign = 'center'
  ctx.fillText('QRDrop Web', els.qrCanvas.width / 2, els.qrCanvas.height / 2 - 12)
  ctx.font = '24px system-ui'
  ctx.fillText('Choose a file to begin', els.qrCanvas.width / 2, els.qrCanvas.height / 2 + 32)
  els.frameTitle.textContent = 'Waiting'
  els.frameSubtitle.textContent = 'Select a file, then scan the setup QR with QRDrop.'
}

function chunkSize() { return Math.max(1, Number.parseInt(els.chunkSize.value || '300', 10)) }
function fps() { return Math.max(0.2, Number.parseFloat(els.fps.value || '5')) }
function setStatus(text) { els.statusPill.textContent = text }
function setProgress(value, text) {
  els.progressBar.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`
  els.progressText.textContent = text
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function base64(bytes) {
  let binary = ''
  const stride = 0x8000
  for (let i = 0; i < bytes.length; i += stride) {
    binary += String.fromCharCode(...bytes.slice(i, i + stride))
  }
  return btoa(binary)
}

function randomHex(byteCount) {
  const bytes = new Uint8Array(byteCount)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

function supportsCompressionStream() {
  return typeof CompressionStream !== 'undefined'
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[unit]}`
}

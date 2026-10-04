import QRCode from 'https://esm.sh/qrcode@1.5.4'
import jsQR from 'https://esm.sh/jsqr@1.4.0'

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
  sendTab: $('sendTab'),
  receiveTab: $('receiveTab'),
  sendView: $('sendView'),
  receiveView: $('receiveView'),
  startCameraButton: $('startCameraButton'),
  stopCameraButton: $('stopCameraButton'),
  resetReceiveButton: $('resetReceiveButton'),
  receiveProgressBar: $('receiveProgressBar'),
  receiveProgressText: $('receiveProgressText'),
  receiveFileCard: $('receiveFileCard'),
  receiveFileName: $('receiveFileName'),
  receiveFileMeta: $('receiveFileMeta'),
  downloadLink: $('downloadLink'),
  receiveCount: $('receiveCount'),
  duplicateCount: $('duplicateCount'),
  invalidCount: $('invalidCount'),
  receiveSupportNote: $('receiveSupportNote'),
  cameraVideo: $('cameraVideo'),
  receiveTitle: $('receiveTitle'),
  receiveSubtitle: $('receiveSubtitle'),
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
let detector = null
let fallbackCanvas = null
let fallbackContext = null
let cameraStream = null
let scanTimer = null
let receiveSession = null
let receiveDuplicates = 0
let receiveInvalid = 0
let receiveObjectURL = null

loadSettingsFromHash()
writeSettingsToHash()
renderEmptyQR()
initReceiverSupport()

els.sendTab.addEventListener('click', () => showMode('send'))
els.receiveTab.addEventListener('click', () => showMode('receive'))
els.startCameraButton.addEventListener('click', startCamera)
els.stopCameraButton.addEventListener('click', stopCamera)
els.resetReceiveButton.addEventListener('click', resetReceiver)

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

function showMode(mode) {
  const receiving = mode === 'receive'
  els.sendView.classList.toggle('hidden', receiving)
  els.receiveView.classList.toggle('hidden', !receiving)
  els.sendTab.classList.toggle('active', !receiving)
  els.receiveTab.classList.toggle('active', receiving)
  setStatus(receiving ? 'Receive' : (frames.length ? 'Ready' : 'Idle'))
}

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

async function initReceiverSupport() {
  if ('BarcodeDetector' in window) {
    const formats = await BarcodeDetector.getSupportedFormats?.() ?? []
    if (!formats.length || formats.includes('qr_code')) {
      detector = new BarcodeDetector({ formats: ['qr_code'] })
      els.receiveSupportNote.textContent = 'Receiver uses your camera locally through BarcodeDetector. No frames are uploaded.'
      return
    }
  }

  fallbackCanvas = document.createElement('canvas')
  fallbackContext = fallbackCanvas.getContext('2d', { willReadFrequently: true })
  detector = null
  els.startCameraButton.disabled = false
  els.receiveSupportNote.textContent = 'BarcodeDetector is not available, so QRDrop Web will use a JavaScript QR decoder fallback. This works on iOS Safari but may be slower; use good lighting and keep the QR large.'
}

async function startCamera() {
  try {
    if (!detector && !fallbackContext) await initReceiverSupport()
    if (!detector && !fallbackContext) return
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    })
    els.cameraVideo.srcObject = cameraStream
    await els.cameraVideo.play()
    els.startCameraButton.disabled = true
    els.stopCameraButton.disabled = false
    els.receiveTitle.textContent = 'Scanning…'
    els.receiveSubtitle.textContent = 'Point the camera at a QRDrop setup QR.'
    setStatus('Scanning')
    scanTimer = setInterval(scanCameraFrame, 100)
  } catch (error) {
    console.error(error)
    receiveMessage(`Camera error: ${error.message || error}`)
  }
}

function stopCamera() {
  if (scanTimer) clearInterval(scanTimer)
  scanTimer = null
  if (cameraStream) {
    for (const track of cameraStream.getTracks()) track.stop()
  }
  cameraStream = null
  els.cameraVideo.srcObject = null
  els.startCameraButton.disabled = !(detector || fallbackContext)
  els.stopCameraButton.disabled = true
  setStatus('Receive')
}

async function scanCameraFrame() {
  if (els.cameraVideo.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return
  try {
    if (detector) {
      const codes = await detector.detect(els.cameraVideo)
      for (const code of codes) {
        const payload = code.rawValue || code.rawData
        if (typeof payload === 'string' && payload) await acceptReceivePayload(payload)
      }
      return
    }

    const payload = scanWithJsQR()
    if (payload) await acceptReceivePayload(payload)
  } catch (error) {
    // Some browsers throw transiently while video dimensions settle.
  }
}

function scanWithJsQR() {
  if (!fallbackCanvas || !fallbackContext) return null
  const width = els.cameraVideo.videoWidth
  const height = els.cameraVideo.videoHeight
  if (!width || !height) return null

  const maxSide = 960
  const scale = Math.min(1, maxSide / Math.max(width, height))
  fallbackCanvas.width = Math.max(1, Math.round(width * scale))
  fallbackCanvas.height = Math.max(1, Math.round(height * scale))
  fallbackContext.drawImage(els.cameraVideo, 0, 0, fallbackCanvas.width, fallbackCanvas.height)
  const imageData = fallbackContext.getImageData(0, 0, fallbackCanvas.width, fallbackCanvas.height)
  const result = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: 'dontInvert' })
  return result?.data || null
}

function resetReceiver() {
  receiveSession = null
  receiveDuplicates = 0
  receiveInvalid = 0
  if (receiveObjectURL) URL.revokeObjectURL(receiveObjectURL)
  receiveObjectURL = null
  els.downloadLink.classList.add('hidden')
  els.downloadLink.removeAttribute('href')
  els.receiveFileCard.classList.add('hidden')
  els.receiveTitle.textContent = 'Receiver ready'
  els.receiveSubtitle.textContent = 'Camera frames are decoded locally in this browser.'
  receiveProgress(0, 'Start the camera and scan a setup QR.')
  updateReceiveStats()
}

async function acceptReceivePayload(payload) {
  let packet
  try {
    packet = JSON.parse(payload)
  } catch {
    receiveInvalid++
    updateReceiveStats()
    return
  }

  if (packet?.v !== 1 || typeof packet.k !== 'string') {
    receiveInvalid++
    updateReceiveStats()
    return
  }

  if (packet.k === 'setup') {
    if (!validSetup(packet)) {
      receiveInvalid++
      receiveMessage('Invalid setup QR.')
      updateReceiveStats()
      return
    }
    if (!receiveSession || receiveSession.id !== packet.id) startReceiveSession(packet)
    return
  }

  if (!receiveSession) return
  if (packet.k !== 'data' || !validData(packet, receiveSession)) {
    receiveInvalid++
    updateReceiveStats()
    return
  }

  if (receiveSession.chunks.has(packet.i)) {
    receiveDuplicates++
    updateReceiveStats()
    return
  }

  const bytes = fromBase64(packet.d)
  if (bytes.byteLength > 8192 || await sha256Hex(bytes) !== packet.h) {
    receiveInvalid++
    updateReceiveStats()
    return
  }

  receiveSession.chunks.set(packet.i, bytes)
  updateReceiveStats()
  receiveProgress(receiveSession.chunks.size / receiveSession.total, `Receiving ${receiveSession.name}: ${receiveSession.chunks.size}/${receiveSession.total}`)
  els.receiveTitle.textContent = `${receiveSession.name}`
  els.receiveSubtitle.textContent = `Receiving QR frames… ${Math.round((receiveSession.chunks.size / receiveSession.total) * 100)}%`

  if (receiveSession.chunks.size === receiveSession.total) await finishReceiveSession()
}

function startReceiveSession(setup) {
  if (receiveObjectURL) URL.revokeObjectURL(receiveObjectURL)
  receiveObjectURL = null
  receiveSession = {
    id: setup.id,
    name: setup.n,
    size: setup.s,
    total: setup.t,
    fileHash: setup.f,
    compression: setup.c || '',
    originalSize: setup.us,
    originalHash: setup.uf,
    chunks: new Map(),
  }
  receiveDuplicates = 0
  receiveInvalid = 0
  els.downloadLink.classList.add('hidden')
  els.receiveFileCard.classList.remove('hidden')
  els.receiveFileName.textContent = setup.n
  els.receiveFileMeta.textContent = `${setup.t} frames · ${formatBytes(setup.s)}${setup.c ? ` · ${setup.c}` : ''}`
  receiveProgress(0, `Setup received for ${setup.n}. Start the sender stream.`)
  updateReceiveStats()
}

async function finishReceiveSession() {
  const session = receiveSession
  if (!session) return
  receiveProgress(1, 'Assembling and verifying…')
  const payload = new Uint8Array(session.size)
  let offset = 0
  for (let i = 0; i < session.total; i++) {
    const chunk = session.chunks.get(i)
    if (!chunk) return
    payload.set(chunk, offset)
    offset += chunk.byteLength
  }
  if (offset !== session.size || await sha256Hex(payload) !== session.fileHash) {
    receiveInvalid++
    receiveMessage('Final transfer verification failed.')
    updateReceiveStats()
    return
  }

  let output = payload
  if (session.compression === 'gzip') {
    output = await gunzip(payload)
    if (output.byteLength !== session.originalSize || await sha256Hex(output) !== session.originalHash) {
      receiveInvalid++
      receiveMessage('Gzip verification failed.')
      updateReceiveStats()
      return
    }
  } else if (session.compression) {
    receiveMessage(`Unsupported compression: ${session.compression}`)
    return
  }

  const blob = new Blob([output], { type: 'application/octet-stream' })
  receiveObjectURL = URL.createObjectURL(blob)
  els.downloadLink.href = receiveObjectURL
  els.downloadLink.download = safeDownloadName(session.name)
  els.downloadLink.textContent = 'Download'
  els.downloadLink.classList.remove('hidden')
  els.receiveFileMeta.textContent = `${formatBytes(output.byteLength)} ready · ${session.total} frames`
  els.receiveTitle.textContent = 'Transfer complete'
  els.receiveSubtitle.textContent = 'Tap Download to save the file.'
  receiveProgress(1, `Complete: ${session.name}`)
  setStatus('Complete')
}

function validSetup(setup) {
  return setup.k === 'setup' && isHex(setup.id, 12) && validName(setup.n) &&
    Number.isInteger(setup.s) && setup.s >= 0 && setup.s <= MAX_FILE_SIZE &&
    Number.isInteger(setup.t) && setup.t > 0 && setup.t <= MAX_CHUNKS &&
    isHex(setup.f, 64) && Number.isInteger(setup.ms) && setup.ms >= 100 && setup.ms <= 5000 &&
    validCompressionMeta(setup)
}

function validData(packet, session) {
  return packet.id === session.id && packet.n === session.name && packet.s === session.size &&
    packet.t === session.total && packet.f === session.fileHash && Number.isInteger(packet.i) &&
    packet.i >= 0 && packet.i < session.total && typeof packet.d === 'string' && isHex(packet.h, 64)
}

function validCompressionMeta(setup) {
  if (!setup.c) return setup.us == null && setup.uf == null
  return setup.c === 'gzip' && Number.isInteger(setup.us) && setup.us >= 0 && setup.us <= MAX_FILE_SIZE && isHex(setup.uf, 64)
}

function validName(name) {
  return typeof name === 'string' && name.length > 0 && !name.includes('/') && !name.includes('\\')
}

function isHex(value, length) {
  return typeof value === 'string' && value.length === length && /^[0-9a-fA-F]+$/.test(value)
}

function updateReceiveStats() {
  const got = receiveSession?.chunks.size ?? 0
  const total = receiveSession?.total ?? 0
  els.receiveCount.textContent = `${got} / ${total}`
  els.duplicateCount.textContent = `Duplicates ${receiveDuplicates}`
  els.invalidCount.textContent = `Invalid ${receiveInvalid}`
}

function receiveProgress(value, text) {
  els.receiveProgressBar.style.width = `${Math.max(0, Math.min(1, value)) * 100}%`
  els.receiveProgressText.textContent = text
}

function receiveMessage(text) {
  els.receiveProgressText.textContent = text
  els.receiveSubtitle.textContent = text
}

function fromBase64(text) {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function gunzip(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot decompress gzip transfers.')
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

function safeDownloadName(name) {
  const cleaned = name.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!cleaned || cleaned === '.' || cleaned === '..') return 'received-file'
  if (cleaned.startsWith('.')) return `received-${cleaned.replace(/^\.+/, '') || 'file'}`
  return cleaned
}

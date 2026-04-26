import { useRef, useState, useEffect } from 'react'
import Peer from 'peerjs'
import './App.css'

const ICE = {
  iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    { urls: 'turn:global.relay.metered.ca:80',                 username: 'ce4d79c0ea31a9556ff1e39f', credential: 's4EIp+6Gsbr6IrEw' },
    { urls: 'turn:global.relay.metered.ca:80?transport=tcp',   username: 'ce4d79c0ea31a9556ff1e39f', credential: 's4EIp+6Gsbr6IrEw' },
    { urls: 'turn:global.relay.metered.ca:443',                username: 'ce4d79c0ea31a9556ff1e39f', credential: 's4EIp+6Gsbr6IrEw' },
    { urls: 'turns:global.relay.metered.ca:443?transport=tcp', username: 'ce4d79c0ea31a9556ff1e39f', credential: 's4EIp+6Gsbr6IrEw' },
  ],
  iceCandidatePoolSize: 10,
  iceTransportPolicy: 'all',
  bundlePolicy: 'max-bundle',
  rtcpMuxPolicy: 'require',
}

const CHUNK = 256 * 1024 // 256KB raw binary chunks

const PEER_SERVER = import.meta.env.VITE_PEER_SERVER || '0.peerjs.com'
const PEER_PORT   = import.meta.env.VITE_PEER_PORT ? parseInt(import.meta.env.VITE_PEER_PORT) : 443
const PEER_PATH   = import.meta.env.VITE_PEER_PATH || '/'

function makePeer(id) {
  return new Peer(id || undefined, {
    host: PEER_SERVER, port: PEER_PORT, path: PEER_PATH, secure: true,
    config: ICE, debug: 0, pingInterval: 2000,
  })
}

export default function App() {
  const videoRef    = useRef(null)
  const peerRef     = useRef(null)
  const connsRef    = useRef({})
  const streamRef   = useRef(null)
  const callsRef    = useRef([])
  const chunksRef   = useRef([])
  const isSyncRef   = useRef(false)

  const [mode, setMode]                     = useState(null)
  const [roomId, setRoomId]                 = useState('')
  const [joinInput, setJoinInput]           = useState('')
  const [status, setStatus]                 = useState('')
  const [viewers, setViewers]               = useState(0)
  const [playing, setPlaying]               = useState(false)
  const [isScreen, setIsScreen]             = useState(false)
  const [hasVideo, setHasVideo]             = useState(false)
  const [copied, setCopied]                 = useState(false)
  const [urlInput, setUrlInput]             = useState('')
  const [transferProgress, setTransferProgress] = useState(0)
  const [transferring, setTransferring]     = useState(false)
  const [chatOpen, setChatOpen]             = useState(false)
  const [messages, setMessages]             = useState([])
  const [chatInput, setChatInput]           = useState('')
  const [unread, setUnread]                 = useState(0)
  const [isFullscreen, setIsFullscreen]     = useState(false)
  const chatEndRef = useRef(null)

  function broadcast(msg, excludePeer) {
    Object.entries(connsRef.current).forEach(([pid, c]) => {
      if (pid !== excludePeer && c.open) c.send(msg)
    })
  }

  // ── HOST ──────────────────────────────────────────
  function hostCreate() {
    const id = 'r' + Math.random().toString(36).substr(2, 7)
    const peer = makePeer(id)
    peerRef.current = peer

    peer.on('open', pid => {
      setRoomId(pid)
      setMode('host')
      setStatus('✅ Room ready — share the invite link')
    })

    peer.on('connection', conn => {
      conn.on('open', () => {
        // ignore binary file transfer connections
        if (conn.serialization === 'binary' || conn.label === 'file') return
        connsRef.current[conn.peer] = conn
        const count = Object.keys(connsRef.current).length
        setViewers(count)
        setStatus(`👥 ${count} viewer(s) connected`)
        const v = videoRef.current
        if (v && v.src && !isScreen) {
          conn.send({ t: 'seek', time: v.currentTime })
          conn.send({ t: v.paused ? 'pause' : 'play' })
        }
        if (streamRef.current) {
          const call = peer.call(conn.peer, streamRef.current)
          callsRef.current.push(call)
        }
      })
      conn.on('data', msg => handleData(msg, conn.peer))
      conn.on('close', () => {
        delete connsRef.current[conn.peer]
        setViewers(Object.keys(connsRef.current).length)
      })
    })

    peer.on('error', e => setStatus('❌ ' + e.type))
    peer.on('disconnected', () => {
      setStatus('⚠️ Network issue — reconnecting...')
      setTimeout(() => peer.reconnect(), 1000)
    })
  }

  async function sendFileTo(conn, file) {
    const totalChunks = Math.ceil(file.size / CHUNK)
    // open a separate binary connection for raw fast transfer
    const binConn = peerRef.current.connect(conn.peer, { reliable: true, serialization: 'binary', label: 'file' })
    await new Promise(resolve => binConn.on('open', resolve))
    binConn.send({ t: 'file-start', name: file.name, size: file.size, total: totalChunks })
    for (let i = 0; i < totalChunks; i++) {
      const buf = await file.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer()
      binConn.send(buf)
      const pct = Math.round(((i + 1) / totalChunks) * 100)
      setTransferProgress(pct)
      if (i % 20 === 0) setStatus(`📤 Sending: ${pct}%`)
      if (i % 20 === 0) await new Promise(r => setTimeout(r, 0))
    }
    binConn.send({ t: 'file-end' })
    setTimeout(() => binConn.close(), 1000)
  }

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    const v = videoRef.current
    v.srcObject = null
    v.src = URL.createObjectURL(file)
    v.load()
    setHasVideo(true)
    setIsScreen(false)
    setPlaying(false)
    setStatus(`📁 ${file.name} loaded`)

    const conns = Object.values(connsRef.current).filter(c => c.open)
    if (conns.length > 0) {
      setTransferring(true)
      for (const conn of conns) await sendFileTo(conn, file)
      setTransferring(false)
      setTransferProgress(0)
      setStatus('✅ Video sent to all viewers')
    }
    peerRef.current._videoFile = file
  }

  function handleUrlLoad() {
    if (!urlInput.trim()) return
    const v = videoRef.current
    v.srcObject = null
    v.src = urlInput.trim()
    v.load()
    setHasVideo(true)
    setIsScreen(false)
    broadcast({ t: 'src', src: urlInput.trim() })
    setStatus('Video loaded')
    setUrlInput('')
  }

  function hostPlay() {
    const v = videoRef.current
    v.play(); setPlaying(true)
    broadcast({ t: 'play', time: v.currentTime })
  }

  function hostPause() {
    const v = videoRef.current
    v.pause(); setPlaying(false)
    broadcast({ t: 'pause', time: v.currentTime })
  }

  function hostSeek() {
    if (isSyncRef.current) return
    broadcast({ t: 'seek', time: videoRef.current.currentTime })
  }

  async function startScreen() {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 24, max: 30 }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 44100 }
      })
      streamRef.current = stream
      const v = videoRef.current
      v.srcObject = stream; v.muted = true; v.play()
      setIsScreen(true); setHasVideo(true); setPlaying(true)
      Object.keys(connsRef.current).forEach(pid => {
        const call = peerRef.current.call(pid, stream)
        callsRef.current.push(call)
      })
      stream.getVideoTracks()[0].onended = stopScreen
      setStatus('🖥 Sharing screen')
    } catch { setStatus('Screen share cancelled') }
  }

  function stopScreen() {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    callsRef.current.forEach(c => c.close())
    callsRef.current = []
    videoRef.current.srcObject = null
    setIsScreen(false); setHasVideo(false); setPlaying(false)
    setStatus('Screen share stopped')
  }

  // ── VIEWER ────────────────────────────────────────
  function viewerJoin() {
    if (!joinInput.trim()) return
    let id = joinInput.trim()
    try { id = new URL(id).searchParams.get('room') || id } catch {}

    const peer = makePeer()
    peerRef.current = peer
    setMode('viewer')
    setStatus('🔄 Connecting...')

    let retries = 0
    const maxRetries = 8

    function tryConnect() {
      if (connsRef.current['host']) {
        try { connsRef.current['host'].close() } catch {}
        delete connsRef.current['host']
      }
      const conn = peer.connect(id, { reliable: true })
      const timeout = setTimeout(() => {
        if (!conn.open) {
          try { conn.close() } catch {}
          if (retries < maxRetries) { retries++; setStatus(`🔄 Retrying... (${retries}/${maxRetries})`); setTimeout(tryConnect, 1000) }
          else setStatus('❌ Could not connect — check Room ID')
        }
      }, 15000)

      conn.on('open', () => {
        clearTimeout(timeout); retries = 0
        connsRef.current['host'] = conn
        setStatus('✅ Connected — waiting for host')
      })
      conn.on('data', msg => handleData(msg, null))
      conn.on('close', () => {
        delete connsRef.current['host']
        setStatus('⚠️ Disconnected — reconnecting...')
        setTimeout(() => peer.disconnected ? peer.reconnect() : tryConnect(), 1500)
      })
      conn.on('error', () => {
        clearTimeout(timeout)
        if (retries < maxRetries) { retries++; setStatus(`🔄 Retrying... (${retries}/${maxRetries})`); setTimeout(tryConnect, 1000) }
        else setStatus('❌ Connection failed')
      })
    }

    peer.on('open', () => { setStatus('🔄 Reaching host...'); tryConnect() })

    // handle incoming binary file transfer connection from host
    peer.on('connection', inConn => {
      if (inConn.serialization === 'binary' || inConn.label === 'file') {
        let fileTotal = 0
        let fileReceived = 0
        inConn.on('data', data => {
          if (data && typeof data === 'object' && !ArrayBuffer.isView(data) && !(data instanceof ArrayBuffer) && data.t === 'file-start') {
            chunksRef.current = []
            fileTotal = data.total
            fileReceived = 0
            setTransferring(true)
            setTransferProgress(0)
            setStatus(`📥 Receiving: ${data.name} (${(data.size / 1024 / 1024).toFixed(1)} MB)`)
          } else if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
            const buf = data instanceof ArrayBuffer ? data : data.buffer
            chunksRef.current.push(buf)
            fileReceived++
            const pct = Math.round((fileReceived / fileTotal) * 100)
            setTransferProgress(pct)
            if (fileReceived % 10 === 0) setStatus(`📥 Receiving: ${pct}%`)
          } else if (data && typeof data === 'object' && data.t === 'file-end') {
            const blob = new Blob(chunksRef.current)
            const url = URL.createObjectURL(blob)
            const v = videoRef.current
            v.srcObject = null; v.src = url; v.load()
            setHasVideo(true); setIsScreen(false)
            setTransferring(false); setTransferProgress(0)
            setStatus('✅ Video ready — waiting for host to play')
            chunksRef.current = []
          }
        })
        return
      }
      // normal JSON control connection (shouldn't happen on viewer but handle gracefully)
    })

    peer.on('call', call => {
      call.answer()
      call.on('stream', remote => {
        const v = videoRef.current
        v.srcObject = remote; v.muted = false; v.volume = 1
        v.play().then(() => { setPlaying(true); setHasVideo(true); setIsScreen(true); setStatus('🟢 Watching live screen') })
          .catch(() => setStatus('Click ▶ Play'))
      })
      call.on('close', () => { setIsScreen(false); setHasVideo(false); setStatus('Screen share ended') })
    })

    peer.on('disconnected', () => { setStatus('⚠️ Reconnecting...'); setTimeout(() => peer.reconnect(), 1000) })
    peer.on('error', e => {
      if (e.type === 'network' || e.type === 'disconnected') setTimeout(() => peer.reconnect(), 1000)
      else setStatus('❌ ' + e.type)
    })
  }

  // ── DATA HANDLER ──────────────────────────────────
  function handleData(msg, fromPeer) {
    const v = videoRef.current

    if (msg.t === 'file-start') {}
    if (msg.t === 'file-chunk') {}
    if (msg.t === 'file-end') {}

    if (msg.t === 'src') { v.srcObject = null; v.src = msg.src; v.load(); setHasVideo(true); setIsScreen(false) }

    if (msg.t === 'play') {
      isSyncRef.current = true
      if (msg.time !== undefined) v.currentTime = msg.time
      v.play().then(() => setPlaying(true)).catch(() => {})
      setTimeout(() => { isSyncRef.current = false }, 500)
    }
    if (msg.t === 'pause') {
      isSyncRef.current = true
      if (msg.time !== undefined) v.currentTime = msg.time
      v.pause(); setPlaying(false)
      setTimeout(() => { isSyncRef.current = false }, 500)
    }
    if (msg.t === 'seek') {
      isSyncRef.current = true
      v.currentTime = msg.time
      setTimeout(() => { isSyncRef.current = false }, 500)
    }

    if (msg.t === 'chat') {
      setMessages(prev => [...prev, { from: msg.from, text: msg.text, time: msg.time }])
      setUnread(u => u + 1)
    }

    if (mode === 'host' && (msg.t === 'play' || msg.t === 'pause' || msg.t === 'seek' || msg.t === 'chat')) {
      broadcast(msg, fromPeer)
    }
  }

  function viewerTogglePlay() {
    const v = videoRef.current
    const conn = connsRef.current['host']
    if (v.paused) { v.play(); setPlaying(true); conn?.send({ t: 'play', time: v.currentTime }) }
    else { v.pause(); setPlaying(false); conn?.send({ t: 'pause', time: v.currentTime }) }
  }

  function sendChat(e) {
    e.preventDefault()
    if (!chatInput.trim()) return
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    const outMsg = { t: 'chat', from: mode === 'host' ? '👑 Host' : '👤 Viewer', text: chatInput.trim(), time }
    setMessages(prev => [...prev, { ...outMsg, from: mode === 'host' ? '👑 You (Host)' : '👤 You' }])
    if (mode === 'host') broadcast(outMsg)
    else connsRef.current['host']?.send(outMsg)
    setChatInput('')
  }

  useEffect(() => {
    if (chatOpen) { setUnread(0); chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }
  }, [messages, chatOpen])

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  function toggleFullscreen() {
    const container = videoRef.current.parentElement
    if (!document.fullscreenElement) container.requestFullscreen()
    else document.exitFullscreen()
  }

  function copyLink() {
    navigator.clipboard.writeText(`${window.location.origin}?room=${roomId}`)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get('room')
    if (room) setJoinInput(room)
  }, [])

  return (
    <div className="player-wrapper">
      <h2>🎬 Watch Together</h2>

      {!mode && (
        <div className="room-section">
          <div className="room-box">
            <h3>🎥 Host</h3>
            <p className="hint">Create a room, upload video or share screen</p>
            <button className="primary-btn" onClick={hostCreate}>Create Room</button>
          </div>
          <div className="divider">OR</div>
          <div className="room-box">
            <h3>👀 Viewer</h3>
            <p className="hint">Paste Room ID or invite link</p>
            <input type="text" placeholder="Room ID or invite link"
              value={joinInput} onChange={e => setJoinInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && viewerJoin()} />
            <button className="primary-btn" onClick={viewerJoin}>Join Room</button>
          </div>
        </div>
      )}

      {mode === 'host' && roomId && (
        <div className="room-info">
          <span>🏠 <strong>{roomId}</strong></span>
          <button onClick={copyLink}>{copied ? '✅ Copied!' : '🔗 Copy Invite Link'}</button>
          {viewers > 0 && <span>👥 {viewers} viewer(s)</span>}
        </div>
      )}

      {status && <p className="status">{status}</p>}

      {transferring && (
        <div className="progress-bar">
          <div className="progress-fill" style={{ width: transferProgress + '%' }} />
          <span>{transferProgress}%</span>
        </div>
      )}

      {mode === 'host' && (
        <div className="source-bar">
          <label className="upload-btn">
            📁 Upload Video
            <input type="file" accept="video/*" onChange={handleFile} hidden />
          </label>
          <div className="url-bar">
            <input type="text" placeholder="Or paste video URL..."
              value={urlInput} onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUrlLoad()} />
            <button onClick={handleUrlLoad}>Load</button>
          </div>
          {!isScreen
            ? <button className="screen-btn" onClick={startScreen}>🖥 Share Screen</button>
            : <button className="screen-btn stop" onClick={stopScreen}>⏹ Stop</button>
          }
        </div>
      )}

      <div className="video-container" style={{ display: hasVideo ? 'block' : 'none' }}>
        <video ref={videoRef} className="video"
          onSeeked={() => mode === 'host' && !isSyncRef.current && hostSeek()}
          onEnded={() => setPlaying(false)}
          onClick={() => setChatOpen(false)}
          onDoubleClick={() => {
            const v = videoRef.current
            if (v.paused) {
              v.play(); setPlaying(true)
              if (mode === 'host') broadcast({ t: 'play', time: v.currentTime })
              else connsRef.current['host']?.send({ t: 'play', time: v.currentTime })
            } else {
              v.pause(); setPlaying(false)
              if (mode === 'host') broadcast({ t: 'pause', time: v.currentTime })
              else connsRef.current['host']?.send({ t: 'pause', time: v.currentTime })
            }
          }}
        />
        {unread > 0 && !chatOpen && (
          <div className="fs-chat-hint" onClick={() => { if (document.fullscreenElement) document.exitFullscreen(); setChatOpen(true) }}>
            <span>{unread}</span>
          </div>
        )}
      </div>

      {hasVideo && (
        <div className="controls">
          {mode === 'host' && !isScreen && (
            playing ? <button onClick={hostPause}>⏸ Pause</button> : <button onClick={hostPlay}>▶ Play</button>
          )}
          {mode === 'viewer' && (
            <button onClick={viewerTogglePlay}>{playing ? '⏸ Pause' : '▶ Play'}</button>
          )}
          <button onClick={toggleFullscreen}>⛶ Fullscreen</button>
        </div>
      )}

      {mode && (
        <div className={`chat-panel ${chatOpen ? 'open' : ''}`}>
          <button className="chat-toggle" onClick={() => setChatOpen(o => !o)}>
            {chatOpen ? '✕' : '💬'}
            {!chatOpen && unread > 0 && <span className="badge">{unread}</span>}
          </button>
          {chatOpen && (
            <>
              <div className="chat-messages">
                {messages.length === 0 && <p className="chat-empty">No messages yet</p>}
                {messages.map((m, i) => (
                  <div key={i} className="chat-msg">
                    <span className="chat-from">{m.from}</span>
                    <span className="chat-time">{m.time}</span>
                    <p className="chat-text">{m.text}</p>
                  </div>
                ))}
                <div ref={chatEndRef} />
              </div>
              <form className="chat-form" onSubmit={sendChat}>
                <input type="text" placeholder="Type a message..."
                  value={chatInput} onChange={e => setChatInput(e.target.value)} />
                <button type="submit">Send</button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  )
}

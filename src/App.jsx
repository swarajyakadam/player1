import { useRef, useState, useEffect, useCallback } from 'react'
import Peer from 'peerjs'
import './App.css'

const PEER_CONFIG = {
  host: '0.peerjs.com',
  port: 443,
  path: '/',
  secure: true,
  debug: 0,
  config: {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
      { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
    ]
  }
}

function App() {
  const videoRef = useRef(null)
  const peerRef = useRef(null)
  const streamRef = useRef(null)
  const connectionsRef = useRef({}) // peerId -> conn
  const callsRef = useRef([])
  const isSyncingRef = useRef(false)

  const [mode, setMode] = useState(null)
  const [roomId, setRoomId] = useState('')
  const [joinId, setJoinId] = useState('')
  const [videoSrc, setVideoSrc] = useState('')
  const [videoName, setVideoName] = useState('')
  const [isScreenShare, setIsScreenShare] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('')
  const [copied, setCopied] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)
  const [urlInput, setUrlInput] = useState('')

  // broadcast to all viewers
  const broadcast = useCallback((msg) => {
    Object.values(connectionsRef.current).forEach(conn => {
      if (conn.open) conn.send(msg)
    })
  }, [])

  // HOST setup
  const startAsHost = () => {
    const id = 'room-' + Math.random().toString(36).substr(2, 8)
    const peer = new Peer(id, PEER_CONFIG)
    peerRef.current = peer

    peer.on('open', peerId => {
      setRoomId(peerId)
      setMode('host')
      setStatus('✅ Room ready! Share the invite link.')
    })

    peer.on('connection', conn => {
      conn.on('open', () => {
        connectionsRef.current[conn.peer] = conn
        setViewerCount(Object.keys(connectionsRef.current).length)
        setStatus(`👥 ${Object.keys(connectionsRef.current).length} viewer(s) connected`)

        // send current video state to new viewer
        const v = videoRef.current
        if (videoSrc) {
          conn.send({ type: 'load', src: videoSrc, name: videoName })
          conn.send({ type: 'seek', time: v.currentTime })
          conn.send({ type: v.paused ? 'pause' : 'play', time: v.currentTime })
        }

        // if screen sharing, call this viewer
        if (streamRef.current) {
          const call = peer.call(conn.peer, streamRef.current)
          callsRef.current.push(call)
        }
      })

      conn.on('close', () => {
        delete connectionsRef.current[conn.peer]
        setViewerCount(Object.keys(connectionsRef.current).length)
      })
    })

    peer.on('error', err => setStatus('❌ Error: ' + err.type))
  }

  // HOST: handle video file upload
  const handleFileUpload = (e) => {
    const file = e.target.files[0]
    if (!file) return
    const url = URL.createObjectURL(file)
    setVideoSrc(url)
    setVideoName(file.name)
    setIsScreenShare(false)
    broadcast({ type: 'load', src: url, name: file.name })
  }

  // HOST: load video from URL
  const handleUrlLoad = () => {
    if (!urlInput.trim()) return
    setVideoSrc(urlInput.trim())
    setVideoName(urlInput.trim())
    setIsScreenShare(false)
    broadcast({ type: 'load', src: urlInput.trim(), name: urlInput.trim() })
    setUrlInput('')
  }

  // HOST: sync play
  const hostPlay = () => {
    const v = videoRef.current
    v.play()
    setPlaying(true)
    broadcast({ type: 'play', time: v.currentTime })
  }

  // HOST: sync pause
  const hostPause = () => {
    const v = videoRef.current
    v.pause()
    setPlaying(false)
    broadcast({ type: 'pause', time: v.currentTime })
  }

  // HOST: sync seek
  const handleSeek = () => {
    if (mode !== 'host') return
    broadcast({ type: 'seek', time: videoRef.current.currentTime })
  }

  // HOST: screen share
  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 48000 }
      })
      streamRef.current = stream
      setVideoSrc('')
      setIsScreenShare(true)
      videoRef.current.srcObject = stream
      videoRef.current.muted = true
      videoRef.current.play()
      setPlaying(true)

      Object.keys(connectionsRef.current).forEach(peerId => {
        const call = peerRef.current.call(peerId, stream)
        callsRef.current.push(call)
      })

      stream.getVideoTracks()[0].onended = stopScreenShare
    } catch {
      setStatus('Screen share cancelled')
    }
  }

  const stopScreenShare = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    callsRef.current.forEach(c => c.close())
    callsRef.current = []
    if (videoRef.current) videoRef.current.srcObject = null
    setIsScreenShare(false)
    setPlaying(false)
    setStatus('Screen share stopped')
  }

  // VIEWER: join room
  const joinRoom = () => {
    if (!joinId.trim()) return
    let id = joinId.trim()
    try { id = new URL(id).searchParams.get('room') || id } catch {}

    const peer = new Peer(undefined, PEER_CONFIG)
    peerRef.current = peer
    setMode('viewer')
    setStatus('🔄 Connecting...')

    peer.on('open', () => {
      setStatus('🔄 Reaching host...')
      const conn = peer.connect(id, { reliable: true, serialization: 'json' })

      conn.on('open', () => {
        setStatus('✅ Connected! Waiting for host...')
      })

      conn.on('data', msg => {
        const v = videoRef.current
        isSyncingRef.current = true
        if (msg.type === 'load') {
          setVideoSrc(msg.src)
          setVideoName(msg.name)
          setIsScreenShare(false)
        }
        if (msg.type === 'play') {
          v.currentTime = msg.time
          v.play().then(() => setPlaying(true)).catch(() => {})
        }
        if (msg.type === 'pause') {
          v.currentTime = msg.time
          v.pause()
          setPlaying(false)
        }
        if (msg.type === 'seek') {
          v.currentTime = msg.time
        }
        setTimeout(() => { isSyncingRef.current = false }, 500)
      })

      conn.on('error', () => setStatus('❌ Connection failed'))
      conn.on('close', () => setStatus('⚠️ Host disconnected'))
    })

    // receive screen share stream
    peer.on('call', call => {
      call.answer()
      call.on('stream', remoteStream => {
        setIsScreenShare(true)
        setVideoSrc('')
        const v = videoRef.current
        v.srcObject = remoteStream
        v.muted = false
        v.volume = 1
        v.play().then(() => { setPlaying(true); setStatus('🟢 Watching live screen') }).catch(() => setStatus('Click ▶ Play'))
      })
      call.on('close', () => { setIsScreenShare(false); setStatus('Screen share ended') })
    })

    peer.on('error', err => setStatus('❌ ' + err.type + ' — check Room ID'))
  }

  // load video when src changes
  useEffect(() => {
    const v = videoRef.current
    if (!v || !videoSrc || isScreenShare) return
    v.srcObject = null
    v.src = videoSrc
    v.load()
  }, [videoSrc, isScreenShare])

  const toggleFullscreen = () => {
    const v = videoRef.current
    if (!document.fullscreenElement) v.requestFullscreen()
    else document.exitFullscreen()
  }

  const copyLink = () => {
    navigator.clipboard.writeText(`${window.location.origin}?room=${roomId}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const room = new URLSearchParams(window.location.search).get('room')
    if (room) setJoinId(room)
  }, [])

  const isHost = mode === 'host'
  const isViewer = mode === 'viewer'

  return (
    <div className="player-wrapper">
      <h2>🎬 Watch Together</h2>

      {!mode && (
        <div className="room-section">
          <div className="room-box">
            <h3>🎥 Host a Room</h3>
            <p className="hint">Upload a video or share your screen</p>
            <button className="primary-btn" onClick={startAsHost}>Create Room</button>
          </div>
          <div className="divider">OR</div>
          <div className="room-box">
            <h3>👀 Join a Room</h3>
            <p className="hint">Enter the Room ID or paste invite link</p>
            <input
              type="text"
              placeholder="Room ID or invite link"
              value={joinId}
              onChange={e => setJoinId(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && joinRoom()}
            />
            <button className="primary-btn" onClick={joinRoom}>Join Room</button>
          </div>
        </div>
      )}

      {isHost && roomId && (
        <div className="room-info">
          <span>🏠 <strong>{roomId}</strong></span>
          <button onClick={copyLink}>{copied ? '✅ Copied!' : '🔗 Copy Invite Link'}</button>
          {viewerCount > 0 && <span>👥 {viewerCount} viewer(s)</span>}
        </div>
      )}

      {status && <p className="status">{status}</p>}

      {isHost && (
        <div className="source-bar">
          <label className="upload-btn">
            📁 Upload Video
            <input type="file" accept="video/*" onChange={handleFileUpload} hidden />
          </label>
          <div className="url-bar">
            <input
              type="text"
              placeholder="Or paste video URL..."
              value={urlInput}
              onChange={e => setUrlInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleUrlLoad()}
            />
            <button onClick={handleUrlLoad}>Load</button>
          </div>
          {!isScreenShare
            ? <button className="screen-btn" onClick={startScreenShare}>🖥 Share Screen</button>
            : <button className="screen-btn stop" onClick={stopScreenShare}>⏹ Stop Share</button>
          }
        </div>
      )}

      {(videoSrc || isScreenShare) && (
        <>
          {videoName && !isScreenShare && <p className="video-name">▶ {videoName}</p>}
          <video
            ref={videoRef}
            className="video"
            onSeeked={handleSeek}
            onEnded={() => setPlaying(false)}
          />
          <div className="controls">
            {isHost && (
              playing
                ? <button onClick={hostPause}>⏸ Pause</button>
                : <button onClick={hostPlay}>▶ Play</button>
            )}
            {isViewer && (
              <button onClick={() => {
                const v = videoRef.current
                if (v.paused) { v.play(); setPlaying(true) }
                else { v.pause(); setPlaying(false) }
              }}>{playing ? '⏸ Pause' : '▶ Play'}</button>
            )}
            <button onClick={toggleFullscreen}>⛶ Fullscreen</button>
          </div>
        </>
      )}
    </div>
  )
}

export default App

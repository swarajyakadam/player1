import { useRef, useState, useEffect } from 'react'
import Peer from 'peerjs'
import './App.css'

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
  { urls: 'stun:stun3.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
]

const peerConfig = { config: { iceServers, iceTransportPolicy: 'all' } }

const sdpTransform = (sdp) => {
  sdp = sdp.replace(/b=AS:\d+/g, 'b=AS:4096')
  sdp = sdp.replace(/a=mid:audio/g, 'a=mid:audio\r\nb=AS:256')
  return sdp
}

function App() {
  const videoRef = useRef(null)
  const peerRef = useRef(null)
  const streamRef = useRef(null)
  const connectionsRef = useRef([])

  const [mode, setMode] = useState(null)
  const [roomId, setRoomId] = useState('')
  const [joinId, setJoinId] = useState('')
  const [inputUrl, setInputUrl] = useState('')
  const [videoSrc, setVideoSrc] = useState('')
  const [isScreenShare, setIsScreenShare] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('')
  const [copied, setCopied] = useState(false)

  const startAsHost = () => {
    const id = 'room-' + Math.random().toString(36).substr(2, 8)
    const peer = new Peer(id, peerConfig)
    peerRef.current = peer
    setRoomId(id)
    setMode('host')
    setStatus('Waiting for viewers to join...')

    peer.on('connection', conn => {
      connectionsRef.current.push(conn)
      setStatus(`${connectionsRef.current.length} viewer(s) connected`)
    })

    peer.on('call', call => call.answer())
  }

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 60, max: 60 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 48000 }
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      videoRef.current.muted = true
      videoRef.current.play()
      setIsScreenShare(true)
      setPlaying(true)

      connectionsRef.current.forEach(conn => {
        const call = peerRef.current.call(conn.peer, stream, { sdpTransform })
        call.on('error', err => console.error('Call error:', err))
      })

      stream.getVideoTracks()[0].onended = stopScreenShare
    } catch (err) {
      setStatus('Screen share cancelled or failed')
    }
  }

  const stopScreenShare = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
    if (videoRef.current) videoRef.current.srcObject = null
    setIsScreenShare(false)
    setPlaying(false)
    setStatus('Screen share stopped')
  }

  const joinRoom = () => {
    if (!joinId.trim()) return
    const peer = new Peer(undefined, peerConfig)
    peerRef.current = peer
    setMode('viewer')
    setStatus('Connecting...')

    peer.on('open', () => {
      const conn = peer.connect(joinId.trim())
      conn.on('open', () => setStatus('Connected! Waiting for host to share screen...'))
      conn.on('error', () => setStatus('Failed to connect to room'))
    })

    peer.on('call', call => {
      call.answer()
      call.on('stream', remoteStream => {
        const v = videoRef.current
        v.srcObject = remoteStream
        v.muted = false
        v.volume = 1
        v.preload = 'auto'
        // small buffer delay to smooth over network hiccups
        v.play().catch(() => setStatus('Click ▶ Play to start watching'))
        setPlaying(true)
        setStatus('Watching live stream')
      })
      call.on('error', () => setStatus('Stream error, try rejoining'))
    })

    peer.on('error', () => setStatus('Connection error. Check the room ID.'))
  }

  const handleLoad = () => {
    if (!inputUrl.trim()) return
    stopScreenShare()
    setVideoSrc(inputUrl.trim())
    setPlaying(false)
  }

  useEffect(() => {
    const v = videoRef.current
    if (!videoSrc || !v) return
    v.srcObject = null
    v.load()
    v.play().then(() => setPlaying(true)).catch(() => {})
  }, [videoSrc])

  const togglePlay = () => {
    const v = videoRef.current
    if (!v.src && !v.srcObject) return
    if (v.paused) { v.play(); setPlaying(true) }
    else { v.pause(); setPlaying(false) }
  }

  const toggleFullscreen = () => {
    const v = videoRef.current
    if (!document.fullscreenElement) v.requestFullscreen()
    else document.exitFullscreen()
  }

  const copyLink = () => {
    const link = `${window.location.origin}?room=${roomId}`
    navigator.clipboard.writeText(link)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const room = params.get('room')
    if (room) setJoinId(room)
  }, [])

  return (
    <div className="player-wrapper">
      <h2>Video Player</h2>

      {!mode && (
        <div className="room-section">
          <div className="room-box">
            <h3>🎥 Host a Stream</h3>
            <button className="primary-btn" onClick={startAsHost}>Create Room</button>
          </div>
          <div className="divider">OR</div>
          <div className="room-box">
            <h3>👀 Join a Stream</h3>
            <input
              type="text"
              placeholder="Enter Room ID or paste link"
              value={joinId}
              onChange={e => setJoinId(e.target.value)}
            />
            <button className="primary-btn" onClick={joinRoom}>Join Room</button>
          </div>
        </div>
      )}

      {mode === 'host' && (
        <div className="room-info">
          <span>Room ID: <strong>{roomId}</strong></span>
          <button onClick={copyLink}>{copied ? '✅ Copied!' : '🔗 Copy Invite Link'}</button>
        </div>
      )}

      {status && <p className="status">{status}</p>}

      {mode && (
        <>
          {mode === 'host' && (
            <div className="url-bar">
              <input
                type="text"
                placeholder="Or paste a video URL..."
                value={inputUrl}
                onChange={e => setInputUrl(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleLoad()}
              />
              <button onClick={handleLoad}>Load</button>
            </div>
          )}

          <video
            ref={videoRef}
            className="video"
            src={isScreenShare ? undefined : videoSrc}
            onEnded={() => setPlaying(false)}
          />

          <div className="controls">
            <button onClick={togglePlay}>{playing ? '⏸ Pause' : '▶ Play'}</button>
            {mode === 'host' && (
              !isScreenShare
                ? <button onClick={startScreenShare}>🖥 Share Screen</button>
                : <button onClick={stopScreenShare} style={{ background: '#c0392b' }}>⏹ Stop Share</button>
            )}
            <button onClick={toggleFullscreen}>⛶ Fullscreen</button>
          </div>
        </>
      )}
    </div>
  )
}

export default App

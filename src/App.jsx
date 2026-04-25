import { useRef, useState, useEffect } from 'react'
import Peer from 'peerjs'
import './App.css'

function App() {
  const videoRef = useRef(null)
  const peerRef = useRef(null)
  const streamRef = useRef(null)
  const callsRef = useRef([])

  const [mode, setMode] = useState(null)
  const [roomId, setRoomId] = useState('')
  const [joinId, setJoinId] = useState('')
  const [inputUrl, setInputUrl] = useState('')
  const [videoSrc, setVideoSrc] = useState('')
  const [isScreenShare, setIsScreenShare] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [status, setStatus] = useState('')
  const [copied, setCopied] = useState(false)
  const [viewerCount, setViewerCount] = useState(0)

  const createPeer = (id) => {
    return new Peer(id, {
      host: '0.peerjs.com',
      port: 443,
      path: '/',
      secure: true,
      config: {
        iceServers: [
          { urls: 'stun:stun.l.google.com:19302' },
          { urls: 'stun:stun1.l.google.com:19302' },
          { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
          { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        ]
      }
    })
  }

  const startAsHost = () => {
    const id = 'stream-' + Math.random().toString(36).substr(2, 8)
    const peer = createPeer(id)
    peerRef.current = peer

    peer.on('open', (peerId) => {
      setRoomId(peerId)
      setMode('host')
      setStatus('Room ready. Share the invite link with friends.')
    })

    peer.on('connection', conn => {
      conn.on('open', () => {
        setViewerCount(v => v + 1)
        setStatus(`Viewer connected!`)
        // send confirmation to viewer
        conn.send({ type: 'connected' })
        // if already sharing, call this viewer immediately
        if (streamRef.current) {
          callViewer(peer, conn.peer, streamRef.current)
        }
      })
      conn.on('close', () => setViewerCount(v => Math.max(0, v - 1)))
    })

    peer.on('error', err => setStatus('Host error: ' + err.type))
  }

  const callViewer = (peer, viewerId, stream) => {
    const call = peer.call(viewerId, stream)
    callsRef.current.push(call)
    call.on('error', err => console.error('call error', err))
  }

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 48000 }
      })
      streamRef.current = stream
      videoRef.current.srcObject = stream
      videoRef.current.muted = true
      videoRef.current.play()
      setIsScreenShare(true)
      setPlaying(true)
      setStatus(`Sharing screen to ${viewerCount} viewer(s)`)

      // call all connected viewers
      const peer = peerRef.current
      // re-fetch connections from peer
      Object.keys(peer.connections).forEach(peerId => {
        peer.connections[peerId].forEach(conn => {
          if (conn.type === 'data' && conn.open) {
            callViewer(peer, peerId, stream)
          }
        })
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

  const joinRoom = () => {
    if (!joinId.trim()) return
    let id = joinId.trim()
    if (id.includes('room=')) {
      id = new URL(id).searchParams.get('room')
    }

    const peer = createPeer(undefined)
    peerRef.current = peer
    setMode('viewer')
    setStatus('Connecting to room...')

    peer.on('open', () => {
      setStatus('Reaching host...')
      const conn = peer.connect(id, { reliable: true })

      conn.on('open', () => {
        setStatus('Reached host! Waiting for screen share...')
      })

      conn.on('data', msg => {
        if (msg?.type === 'connected') setStatus('✅ Connected to host! Waiting for screen share...')
      })

      conn.on('error', err => {
        setStatus('Connection failed: ' + err)
      })
    })

    peer.on('call', call => {
      call.answer()
      call.on('stream', remoteStream => {
        const v = videoRef.current
        v.srcObject = remoteStream
        v.muted = false
        v.volume = 1
        v.play()
          .then(() => { setPlaying(true); setStatus('🟢 Live') })
          .catch(() => setStatus('Click ▶ Play to watch'))
      })
      call.on('close', () => setStatus('Host stopped sharing'))
      call.on('error', () => setStatus('Stream error'))
    })

    peer.on('error', err => {
      setStatus('Error: ' + err.type + ' — check Room ID')
    })
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
              placeholder="Enter Room ID or paste invite link"
              value={joinId}
              onChange={e => setJoinId(e.target.value)}
            />
            <button className="primary-btn" onClick={joinRoom}>Join Room</button>
          </div>
        </div>
      )}

      {mode === 'host' && roomId && (
        <div className="room-info">
          <span>Room ID: <strong>{roomId}</strong></span>
          <button onClick={copyLink}>{copied ? '✅ Copied!' : '🔗 Copy Invite Link'}</button>
          {viewerCount > 0 && <span>👥 {viewerCount} viewer(s)</span>}
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

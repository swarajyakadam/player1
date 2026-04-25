import { useRef, useState, useEffect } from 'react'
import Peer from 'peerjs'
import './App.css'

const iceServers = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
]

const peerConfig = { config: { iceServers } }

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

    peer.on('open', () => {
      setStatus('Room ready. Waiting for viewers...')
    })

    // when a viewer connects, if already sharing — call them immediately
    peer.on('connection', conn => {
      conn.on('open', () => {
        connectionsRef.current.push(conn)
        setStatus(`${connectionsRef.current.length} viewer(s) connected`)

        // if screen share is already active, call this new viewer right away
        if (streamRef.current) {
          const call = peer.call(conn.peer, streamRef.current)
          call.on('error', err => console.error(err))
        }
      })
    })
  }

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { echoCancellation: false, noiseSuppression: false, sampleRate: 48000 }
      })
      streamRef.current = stream

      const v = videoRef.current
      v.srcObject = stream
      v.muted = true
      v.play()
      setIsScreenShare(true)
      setPlaying(true)

      // call all already-connected viewers
      connectionsRef.current.forEach(conn => {
        const call = peerRef.current.call(conn.peer, stream)
        call.on('error', err => console.error('call error:', err))
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
    const id = joinId.trim().includes('room=')
      ? new URLSearchParams(joinId.trim().split('?')[1]).get('room')
      : joinId.trim()

    const peer = new Peer(undefined, peerConfig)
    peerRef.current = peer
    setMode('viewer')
    setStatus('Connecting...')

    peer.on('open', () => {
      // send connection request to host so host knows we exist
      const conn = peer.connect(id)
      conn.on('open', () => {
        setStatus('Connected! Waiting for host to share screen...')
      })
      conn.on('error', () => setStatus('Failed to connect to room'))
    })

    // host will call us when screen share starts
    peer.on('call', call => {
      call.answer() // answer with no stream (viewer has nothing to send)
      call.on('stream', remoteStream => {
        const v = videoRef.current
        v.srcObject = remoteStream
        v.muted = false
        v.volume = 1
        v.play()
          .then(() => { setPlaying(true); setStatus('🟢 Watching live') })
          .catch(() => setStatus('Click ▶ Play to watch'))
      })
      call.on('error', err => {
        console.error(err)
        setStatus('Stream error. Try rejoining.')
      })
    })

    peer.on('error', err => {
      console.error(err)
      setStatus('Connection error. Check the Room ID.')
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

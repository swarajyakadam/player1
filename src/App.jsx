import { useRef, useState, useEffect } from 'react'
import './App.css'

function App() {
  const videoRef = useRef(null)
  const [playing, setPlaying] = useState(false)
  const [inputUrl, setInputUrl] = useState('')
  const [videoSrc, setVideoSrc] = useState('')
  const [isScreenShare, setIsScreenShare] = useState(false)
  const streamRef = useRef(null)

  const handleLoad = () => {
    if (!inputUrl.trim()) return
    stopScreenShare()
    setVideoSrc(inputUrl.trim())
    setPlaying(false)
  }

  useEffect(() => {
    const v = videoRef.current
    if (!videoSrc || !v) return
    v.load()
    v.play().then(() => setPlaying(true)).catch(() => {})
  }, [videoSrc])

  const startScreenShare = async () => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true
      })
      streamRef.current = stream
      const v = videoRef.current
      v.srcObject = stream
      v.play()
      setIsScreenShare(true)
      setPlaying(true)
      stream.getVideoTracks()[0].onended = () => stopScreenShare()
    } catch (err) {
      console.error('Screen share error:', err)
    }
  }

  const stopScreenShare = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop())
      streamRef.current = null
    }
    const v = videoRef.current
    if (v) v.srcObject = null
    setIsScreenShare(false)
    setPlaying(false)
  }

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

  return (
    <div className="player-wrapper">
      <h2>Video Player</h2>
      <div className="url-bar">
        <input
          type="text"
          placeholder="Paste video URL here..."
          value={inputUrl}
          onChange={e => setInputUrl(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleLoad()}
        />
        <button onClick={handleLoad}>Load</button>
      </div>
      <video
        ref={videoRef}
        className="video"
        src={isScreenShare ? undefined : videoSrc}
        onEnded={() => setPlaying(false)}
        muted={false}
      />
      <div className="controls">
        <button onClick={togglePlay}>{playing ? '⏸ Pause' : '▶ Play'}</button>
        {!isScreenShare
          ? <button onClick={startScreenShare}>🖥 Share Screen</button>
          : <button onClick={stopScreenShare} style={{background:'#c0392b'}}>⏹ Stop Share</button>
        }
        <button onClick={toggleFullscreen}>⛶ Fullscreen</button>
      </div>
    </div>
  )
}

export default App

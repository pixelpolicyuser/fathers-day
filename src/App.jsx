import { useEffect, useRef, useState } from 'react'
import './App.css'
import './portrait.css'

const sounds = [
  ['♩', 'Upright Bass', 'Four strings, deep pocket.'],
  ['⌁', 'Bass Guitar', 'The heartbeat of the room.'],
  ['♬', 'Guitar', 'A little rhythm, a little shine.'],
  ['●', 'Vocals', 'Say it so folks can feel it.'],
  ['⌂', 'Basement Sessions', 'The best seat is saved.'],
]

const tunerStrings = {
  bass: [
    { label: 'E1', name: 'E', frequency: 41.2 },
    { label: 'A1', name: 'A', frequency: 55 },
    { label: 'D2', name: 'D', frequency: 73.42 },
    { label: 'G2', name: 'G', frequency: 98 },
  ],
  guitar: [
    { label: 'E2', name: 'Low E', frequency: 82.41 },
    { label: 'A2', name: 'A', frequency: 110 },
    { label: 'D3', name: 'D', frequency: 146.83 },
    { label: 'G3', name: 'G', frequency: 196 },
    { label: 'B3', name: 'B', frequency: 246.94 },
    { label: 'E4', name: 'High E', frequency: 329.63 },
  ],
}

const noteNames = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
const centsBetween = (frequency, target) => Math.round(1200 * Math.log2(frequency / target))
const noteFromFrequency = frequency => {
  const midi = Math.round(69 + 12 * Math.log2(frequency / 440))
  const note = noteNames[((midi % 12) + 12) % 12]
  const octave = Math.floor(midi / 12) - 1
  return `${note}${octave}`
}

const detectPitch = (buffer, sampleRate) => {
  let sum = 0
  for (const sample of buffer) sum += sample * sample
  if (Math.sqrt(sum / buffer.length) < .012) return null

  let bestLag = -1
  let bestCorrelation = 0
  const minLag = Math.floor(sampleRate / 1000)
  const maxLag = Math.min(Math.floor(sampleRate / 35), Math.floor(buffer.length / 2))

  for (let lag = minLag; lag <= maxLag; lag++) {
    let difference = 0
    const limit = buffer.length - lag
    for (let i = 0; i < limit; i++) difference += Math.abs(buffer[i] - buffer[i + lag])
    const correlation = 1 - difference / limit
    if (correlation > bestCorrelation) {
      bestCorrelation = correlation
      bestLag = lag
    }
  }

  if (bestCorrelation < .55 || bestLag < 0) return null
  return sampleRate / bestLag
}

const impulse = (ctx, room) => {
  const n = Math.floor(ctx.sampleRate * (.3 + room * .024))
  const b = ctx.createBuffer(2, n, ctx.sampleRate)
  for (let c = 0; c < 2; c++) {
    const d = b.getChannelData(c)
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2
  }
  return b
}

export default function App() {
  const [recording, setRecording] = useState(false)
  const [blob, setBlob] = useState(null)
  const [url, setUrl] = useState('')
  const [status, setStatus] = useState('Tap Record when you are ready. Your recording stays on this device.')
  const [playing, setPlaying] = useState(false)
  const [song, setSong] = useState('')
  const [artist, setArtist] = useState('')
  const [source, setSource] = useState('imslp')
  const [chartMode, setChartMode] = useState('sheet')
  const [chordSong, setChordSong] = useState('')
  const [chordArtist, setChordArtist] = useState('')
  const [instrument, setInstrument] = useState('bass')
  const [chordSource, setChordSource] = useState('ultimate')
  const [warmth, setWarmth] = useState(48)
  const [echo, setEcho] = useState(16)
  const [room, setRoom] = useState(24)
  const [pitch, setPitch] = useState(0)
  const [tunerMode, setTunerMode] = useState('bass')
  const [targetIndex, setTargetIndex] = useState(0)
  const [tunerRunning, setTunerRunning] = useState(false)
  const [tunerStatus, setTunerStatus] = useState('Pick an instrument, tap Start Tuner, then play one open string at a time.')
  const [tunerReadout, setTunerReadout] = useState({ note: '—', frequency: null, cents: 0, direction: 'Ready' })
  const rec = useRef()
  const audio = useRef()
  const ctx = useRef()
  const nodes = useRef()
  const tunerCtx = useRef()
  const tunerAnalyser = useRef()
  const tunerStream = useRef()
  const tunerRaf = useRef()
  const tunerBuffer = useRef()
  const tunerModeRef = useRef(tunerMode)
  const targetIndexRef = useRef(targetIndex)

  useEffect(() => {
    if (!blob) return
    const next = URL.createObjectURL(blob)
    setUrl(next)
    return () => URL.revokeObjectURL(next)
  }, [blob])

  useEffect(() => {
    tunerModeRef.current = tunerMode
    targetIndexRef.current = targetIndex
  }, [tunerMode, targetIndex])

  const stopTuner = ({ silent = false } = {}) => {
    if (tunerRaf.current) cancelAnimationFrame(tunerRaf.current)
    tunerRaf.current = null
    tunerStream.current?.getTracks().forEach(track => track.stop())
    tunerStream.current = null
    tunerCtx.current?.close()
    tunerCtx.current = null
    tunerAnalyser.current = null
    tunerBuffer.current = null
    if (!silent) {
      setTunerRunning(false)
      setTunerStatus('Tuner stopped. Tap Start Tuner when you want to listen again.')
    }
  }

  useEffect(() => () => stopTuner({ silent: true }), [])

  const startTuner = async () => {
    if (recording) {
      setTunerStatus('Finish the recorder first, then start the tuner.')
      return
    }

    try {
      const C = window.AudioContext || window.webkitAudioContext
      if (!C) throw new Error('AudioContext unavailable')

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      const context = new C()
      const analyser = context.createAnalyser()
      analyser.fftSize = 8192
      analyser.smoothingTimeConstant = .32
      context.createMediaStreamSource(stream).connect(analyser)

      tunerCtx.current = context
      tunerStream.current = stream
      tunerAnalyser.current = analyser
      tunerBuffer.current = new Float32Array(analyser.fftSize)
      setTunerRunning(true)
      setTunerStatus('Listening now. Play the selected open string nice and steady.')

      const listen = () => {
        const activeAnalyser = tunerAnalyser.current
        const activeBuffer = tunerBuffer.current
        if (!activeAnalyser || !activeBuffer) return

        activeAnalyser.getFloatTimeDomainData(activeBuffer)
        const frequency = detectPitch(activeBuffer, tunerCtx.current.sampleRate)
        const target = tunerStrings[tunerModeRef.current][targetIndexRef.current]

        if (frequency) {
          const cents = clamp(centsBetween(frequency, target.frequency), -50, 50)
          const direction = Math.abs(cents) <= 5 ? 'In tune' : cents < 0 ? 'Too low' : 'Too high'
          setTunerReadout({
            note: noteFromFrequency(frequency),
            frequency,
            cents,
            direction,
          })
        } else {
          setTunerReadout(current => ({
            ...current,
            direction: 'Play a little louder',
            frequency: null,
          }))
        }

        tunerRaf.current = requestAnimationFrame(listen)
      }

      listen()
    } catch {
      setTunerRunning(false)
      setTunerStatus('The tuner needs microphone permission. On Android Chrome, allow the microphone when asked.')
    }
  }

  const chooseTunerMode = mode => {
    setTunerMode(mode)
    setTargetIndex(0)
    setTunerReadout({ note: '—', frequency: null, cents: 0, direction: 'Ready' })
    setTunerStatus(`Ready for ${mode === 'bass' ? 'Bass Guitar' : 'Six String Guitar'}. Tap Start Tuner when you want to listen.`)
  }

  const graph = () => {
    if (nodes.current) return nodes.current
    const C = window.AudioContext || window.webkitAudioContext
    if (!C) return null
    const c = new C()
    const s = c.createMediaElementSource(audio.current)
    const f = c.createBiquadFilter()
    const d = c.createDelay(1.3)
    const eg = c.createGain()
    const rv = c.createConvolver()
    const rg = c.createGain()
    f.type = 'lowpass'
    s.connect(f).connect(c.destination)
    s.connect(d).connect(eg).connect(c.destination)
    s.connect(rv).connect(rg).connect(c.destination)
    ctx.current = c
    nodes.current = { f, d, eg, rv, rg }
    return nodes.current
  }

  const tune = () => {
    const n = nodes.current
    const c = ctx.current
    if (!n) return
    const t = c.currentTime
    n.f.frequency.setTargetAtTime(7200 - warmth * 48, t, .04)
    n.d.delayTime.setTargetAtTime(.12 + echo * .005, t, .04)
    n.eg.gain.setTargetAtTime(echo / 145, t, .04)
    n.rv.buffer = impulse(c, room)
    n.rg.gain.setTargetAtTime(room / 130, t, .04)
  }

  useEffect(() => {
    tune()
    if (audio.current) audio.current.playbackRate = 2 ** (pitch / 12)
  }, [warmth, echo, room, pitch])

  const toggle = async () => {
    if (recording) {
      rec.current.stop()
      setRecording(false)
      setStatus('Putting your take together…')
      return
    }

    try {
      if (tunerRunning) stopTuner()
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const r = new MediaRecorder(stream)
      const chunks = []
      rec.current = r
      r.ondataavailable = e => e.data.size && chunks.push(e.data)
      r.onstop = () => {
        setBlob(new Blob(chunks, { type: r.mimeType || 'audio/webm' }))
        stream.getTracks().forEach(t => t.stop())
        setStatus('That sounded good. Use Play, shape the sound, then save it.')
      }
      r.start()
      setRecording(true)
      setStatus('Recording now. Play whatever feels right.')
    } catch {
      setStatus('Your browser needs microphone permission before it can record.')
    }
  }

  const play = async () => {
    if (!url) {
      setStatus('Make a recording first, then it will be ready to play.')
      return
    }
    graph()
    if (ctx.current?.state === 'suspended') await ctx.current.resume()
    tune()
    audio.current.playbackRate = 2 ** (pitch / 12)
    await audio.current.play()
    setPlaying(true)
    setStatus('Playing your take. Turn the controls while it plays.')
  }

  const save = () => {
    if (!blob) {
      setStatus('Record a little something first.')
      return
    }
    const a = document.createElement('a')
    a.href = url
    a.download = `lennys-music-room-${new Date().toISOString().slice(0, 10)}.${blob.type.includes('mp4') ? 'm4a' : 'webm'}`
    a.click()
    setStatus('Your device is saving the recording. Look in Downloads or Files.')
  }

  const charts = e => {
    e.preventDefault()
    const q = [song, artist, 'sheet music'].filter(Boolean).join(' ')
    if (!q) {
      setStatus('Add a song title first, then I can open a chart search.')
      return
    }
    const link = source === 'imslp'
      ? `https://imslp.org/index.php?title=Special:Search&search=${encodeURIComponent(q)}`
      : `https://musescore.com/sheetmusic?text=${encodeURIComponent(q)}`
    window.open(link, '_blank', 'noopener,noreferrer')
    setStatus('Opening a sheet-music search in a new tab. Check the license before downloading.')
  }

  const chordCharts = e => {
    e.preventDefault()
    const instrumentName = instrument === 'bass' ? 'bass guitar' : 'guitar'
    const chartType = instrument === 'bass' ? 'bass tab chord chart' : 'chords chord chart'
    const q = [chordSong, chordArtist, chartType].filter(Boolean).join(' ')
    if (!q) {
      setStatus('Add a song title first, then I can open a chord-chart search.')
      return
    }
    const encoded = encodeURIComponent(q)
    const simple = encodeURIComponent([chordSong, chordArtist].filter(Boolean).join(' '))
    const link = {
      ultimate: `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encoded}`,
      songsterr: `https://www.songsterr.com/?pattern=${encoded}`,
      tunearch: `https://tunearch.org/wiki/Special:Search?search=${simple || encoded}`,
      archive: `https://archive.org/search?query=${encoded}`,
    }[chordSource]
    window.open(link, '_blank', 'noopener,noreferrer')
    setStatus(`Opening a ${instrumentName} chord-chart search in a new tab. Check the page terms before saving or printing.`)
  }

  const activeStrings = tunerStrings[tunerMode]
  const targetString = activeStrings[targetIndex] || activeStrings[0]
  const needleLeft = `${50 + tunerReadout.cents}%`

  return (
    <main>
      <header>
        <a className="brand" href="#home"><span>♩</span> Lenny’s <em>Music Room</em></a>
        <nav>
          <a href="#player">Player</a>
          <a href="#tuner">Tuner</a>
          <a href="#sound">Lenny’s Sound</a>
          <a href="#charts">Find a chart</a>
        </nav>
      </header>

      <section className="hero" id="home">
        <div>
          <p className="eyebrow">Happy Father’s Day, Lenny.</p>
          <h1>Pull up a chair.<br />Make some music.</h1>
          <p>Friends, soul, and good grooves have always belonged together in the basement.</p>
          <p className="instruments">Bass guitar · upright bass · guitar · vocals</p>
        </div>
      </section>

      <section className="studio" id="player">
        <section className="recording">
          <h2>The next session starts here.</h2>
          <p className="status" role="status">{status}</p>
          <div className="actions">
            <button className={'record ' + (recording ? 'live' : '')} onClick={toggle}>
              <span>{recording ? '■' : '●'}</span>{recording ? ' Finish recording' : ' Record'}
            </button>
            <button className="play" onClick={play} disabled={!url}>▶ Play it back</button>
          </div>
          {url && <audio ref={audio} src={url} onEnded={() => setPlaying(false)} />}
          <p className="save">
            <button onClick={save} disabled={!url}>Save this recording</button>
            {playing && <span>Now playing</span>}
          </p>
        </section>

        <section className="effects">
          <h2>Shape the sound</h2>
          <Knob title="Warmth" value={warmth} set={setWarmth} max="100" copy="Make it smooth and rich." />
          <Knob title="Echo" value={echo} set={setEcho} max="70" copy="Add a little space." />
          <Knob title="Room" value={room} set={setRoom} max="70" copy="Set the basement feel." />
          <Knob title="Pitch" value={pitch} set={setPitch} min="-8" max="8" copy="Move it up or down gently." output={pitch === 0 ? 'just right' : `${pitch > 0 ? '+' : ''}${pitch} steps`} />
        </section>
      </section>

      <section className="tuner" id="tuner" aria-labelledby="tuner-title">
        <div className="tuner-copy">
          <p className="eyebrow">Built for open strings</p>
          <h2 id="tuner-title">Tune up before the next song.</h2>
          <p>{tunerStatus}</p>
          <div className="tuner-tabs" role="tablist" aria-label="Tuner instrument">
            <button type="button" role="tab" aria-selected={tunerMode === 'bass'} className={tunerMode === 'bass' ? 'active' : ''} onClick={() => chooseTunerMode('bass')}>Bass Guitar</button>
            <button type="button" role="tab" aria-selected={tunerMode === 'guitar'} className={tunerMode === 'guitar' ? 'active' : ''} onClick={() => chooseTunerMode('guitar')}>Six String Guitar</button>
          </div>
        </div>

        <div className="tuner-panel">
          <div className="string-row" aria-label="Choose a string">
            {activeStrings.map((string, index) => (
              <button type="button" key={string.label} className={index === targetIndex ? 'active' : ''} onClick={() => setTargetIndex(index)}>
                <span>{string.name}</span>
                <b>{string.label}</b>
                <small>{string.frequency.toFixed(2)} Hz</small>
              </button>
            ))}
          </div>

          <div className="tuner-readout" aria-live="polite">
            <span>Target</span>
            <strong>{targetString.label}</strong>
            <small>{targetString.frequency.toFixed(2)} Hz</small>
          </div>

          <div className="meter" aria-label={`Tuning meter: ${tunerReadout.direction}`}>
            <span>♭</span>
            <div className="meter-track">
              <i style={{ left: needleLeft }} />
              <b />
            </div>
            <span>♯</span>
          </div>

          <div className="detected">
            <div>
              <span>Detected</span>
              <strong>{tunerReadout.note}</strong>
              <small>{tunerReadout.frequency ? `${tunerReadout.frequency.toFixed(1)} Hz` : 'Waiting for a steady note'}</small>
            </div>
            <div>
              <span>Status</span>
              <strong>{tunerReadout.direction}</strong>
              <small>{tunerReadout.frequency ? `${Math.abs(Math.round(tunerReadout.cents))} cents ${tunerReadout.cents < 0 ? 'flat' : tunerReadout.cents > 0 ? 'sharp' : 'centered'}` : '—'}</small>
            </div>
          </div>

          <button className={'tuner-toggle ' + (tunerRunning ? 'listening' : '')} type="button" onClick={tunerRunning ? stopTuner : startTuner}>
            {tunerRunning ? 'Stop Tuner' : 'Start Tuner'}
          </button>
          <p className="tuner-note">Tip: tune one open string at a time, close to the phone microphone. Your audio stays on this device.</p>
        </div>
      </section>

      <section className="lower">
        <section className="sound" id="sound">
          <h2>Lenny’s Sound</h2>
          <p>Four strings, six strings, one good voice.</p>
          <div className="sound-grid">
            {sounds.map(x => (
              <article key={x[1]}>
                <b>{x[0]}</b>
                <h3>{x[1]}</h3>
                <small>{x[2]}</small>
              </article>
            ))}
          </div>
        </section>

        <section className="charts" id="charts">
          <h2>Find a chart</h2>
          <p>Search music resources without leaving the room.</p>
          <div className="chart-tabs" role="tablist" aria-label="Chart search type">
            <button type="button" role="tab" aria-selected={chartMode === 'sheet'} className={chartMode === 'sheet' ? 'active' : ''} onClick={() => setChartMode('sheet')}>Sheet Music</button>
            <button type="button" role="tab" aria-selected={chartMode === 'chords'} className={chartMode === 'chords' ? 'active' : ''} onClick={() => setChartMode('chords')}>Chord Chart</button>
          </div>

          {chartMode === 'sheet' ? (
            <form onSubmit={charts} className="chart-panel" aria-label="Find sheet music">
              <label>Song title<input value={song} onChange={e => setSong(e.target.value)} placeholder="What are you playing?" /></label>
              <label>Artist <i>(optional)</i><input value={artist} onChange={e => setArtist(e.target.value)} placeholder="Who made it famous?" /></label>
              <label>Search in<select value={source} onChange={e => setSource(e.target.value)}>
                <option value="imslp">IMSLP public-domain library</option>
                <option value="musescore">MuseScore community library</option>
              </select></label>
              <button>Find sheet music ↗</button>
            </form>
          ) : (
            <form onSubmit={chordCharts} className="chart-panel" aria-label="Find a chord chart">
              <label>Song title<input value={chordSong} onChange={e => setChordSong(e.target.value)} placeholder="What are you playing?" /></label>
              <label>Artist <i>(optional)</i><input value={chordArtist} onChange={e => setChordArtist(e.target.value)} placeholder="Who made it famous?" /></label>
              <label>Instrument<select value={instrument} onChange={e => setInstrument(e.target.value)}>
                <option value="bass">Bass Guitar</option>
                <option value="guitar">Six String Guitar</option>
              </select></label>
              <label>Search in<select value={chordSource} onChange={e => setChordSource(e.target.value)}>
                <option value="ultimate">Ultimate Guitar community charts</option>
                <option value="songsterr">Songsterr tabs and chords</option>
                <option value="tunearch">Traditional Tune Archive</option>
                <option value="archive">Internet Archive</option>
              </select></label>
              <button>Find a chord chart ↗</button>
            </form>
          )}
          <small>Not every song is free to download or print. Always check the chart’s license, terms, or source notes before using it.</small>
        </section>
      </section>

      <footer>Made with love for Lenny Ball — where the groove lives.</footer>
    </main>
  )
}

function Knob({ title, value, set, min = 0, max, copy, output }) {
  return (
    <label className="knob">
      <span><b>{title}</b><small>{copy}</small></span>
      <input type="range" min={min} max={max} value={value} onChange={e => set(+e.target.value)} aria-label={title} />
      <output>{output || `${value}%`}</output>
    </label>
  )
}

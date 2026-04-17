
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import axios from 'axios';

function formatDate(date) {
  const d = new Date(date);
  return d.toLocaleDateString();
}
function todayISO() { return new Date().toISOString().slice(0,10); }
// These helpers preserve legitimate 0 values from nutrition APIs while still treating blanks as empty.
function hasValue(value) { return value !== undefined && value !== null && value !== ''; }
function fieldValue(value) { return hasValue(value) ? String(value) : ''; }
function numberOrNull(value) { return hasValue(value) ? Number(value) : null; }

export default function Calories(){
  // Form state stays editable after an API lookup so the user can correct nutrition data before saving.
  const [entries, setEntries] = useState([]);
  const [food, setFood] = useState('');
  const [calories, setCalories] = useState('');
  const [proteins, setProteins] = useState('');
  const [fats, setFats] = useState('');
  const [carbs, setCarbs] = useState('');
  const [date, setDate] = useState(todayISO());
  const [selectedDate, setSelectedDate] = useState(todayISO());
  const [barcode, setBarcode] = useState('');
  const [scanning, setScanning] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [user, setUser] = useState(null);
  const [message, setMessage] = useState(null);
  const [barcodeStatus, setBarcodeStatus] = useState('');
  const [barcodeLoading, setBarcodeLoading] = useState(false);
  const [videoDevices, setVideoDevices] = useState([]);
  const [selectedCameraId, setSelectedCameraId] = useState('');
  const [zoomRange, setZoomRange] = useState(null);
  const [zoomValue, setZoomValue] = useState('');

  const videoRef = useRef(null);
  // Refs hold scanner resources without causing render loops while frames are decoded.
  const scanIntervalRef = useRef(null);
  const scanBusyRef = useRef(false);
  const zxingRef = useRef(null);
  const barcodeLookupRef = useRef(false);
  const activeVideoTrackRef = useRef(null);
  const API = useMemo(()=>axios.create({ baseURL: 'http://localhost:5000' }), []);

  useEffect(()=>{
    // Load saved identity and attach the auth token before the first meal fetch.
    const token = localStorage.getItem('token');
    if (token) API.defaults.headers.common['Authorization'] = `Bearer ${token}`;
    const stored = localStorage.getItem('user');
    if (stored) try{ setUser(JSON.parse(stored)); }catch{}
    fetchMeals(selectedDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[]);

  const fetchMeals = useCallback(async (d)=>{
    // Pull only the selected date so totals and the visible log stay scoped to one day.
    const uid = user?.id || Number(localStorage.getItem('fitness_user_id')) || null;
    if (!uid) return setEntries([]);
    try{
      const res = await API.get('/meals',{ params: { user_id: uid, date: d } });
      setEntries(res.data || []);
    }catch(e){ console.error(e); setEntries([]); }
  },[API,user]);

  useEffect(()=>{ fetchMeals(selectedDate); },[fetchMeals,selectedDate]);

  async function ensureUser(){
    // Meal entries need a user id; create a local profile lazily if none exists yet.
    if (user && user.id) return user.id;
    const stored = localStorage.getItem('fitness_user_id');
    if (stored){ setUser({ id: Number(stored)}); return Number(stored); }
    // create local user
    try{
      const email = `local_${Date.now()}@local`;
      const res = await API.post('/users',{ name: 'Local User', email });
      if (res.data){ localStorage.setItem('fitness_user_id', res.data.id); setUser(res.data); return res.data.id; }
    }catch(e){ console.error('ensureUser failed', e); }
    return null;
  }

  async function addEntry(){
    // Save the editable form values as a food record and a dated meal entry.
    if (!food || !hasValue(calories)) return alert('Please provide food name and calories');
    const uid = user?.id || await ensureUser();
    try{
      // create or find food
      let fRec = null;
      if (barcode){
        try{ const r = await API.get(`/foods/barcode/${encodeURIComponent(barcode)}`); fRec = r.data; }catch{}
      }
      if (!fRec){ const r = await API.post('/foods',{ name: food, barcode: barcode || null, calories: numberOrNull(calories), proteins: numberOrNull(proteins), fats: numberOrNull(fats), carbs: numberOrNull(carbs) }); fRec = r.data; }

      const payload = { user_id: uid, food_id: fRec?.id || null, date, calories: numberOrNull(calories), proteins: numberOrNull(proteins), fats: numberOrNull(fats), carbs: numberOrNull(carbs) };
      if (editingId){ await API.put(`/meals/${editingId}`, payload); }
      else { await API.post('/meals', payload); }
      setFood(''); setCalories(''); setProteins(''); setFats(''); setCarbs(''); setBarcode(''); setEditingId(null);
      fetchMeals(selectedDate);
    try{ /* show success message briefly */
      showMessage(`Saved ${food}: ${hasValue(payload.calories) ? payload.calories : ''} kcal`);
    }catch(e){}
    }catch(e){ console.error('addEntry failed', e); alert('Save failed: '+(e?.response?.data?.error||e.message)); }
  }

  const deleteEntry = async (id)=>{ try{ await API.delete(`/meals/${id}`); }catch(e){ console.error(e); } fetchMeals(selectedDate); };

  // Copy a log row back into the form so the same save path can update it.
  const startEdit = (m)=>{ setEditingId(m.id); setFood(m.food_name||m.note||''); setCalories(fieldValue(m.calories)); setProteins(fieldValue(m.proteins)); setFats(fieldValue(m.fats)); setCarbs(fieldValue(m.carbs)); setDate(m.date||todayISO()); };
  const cancelEdit = ()=>{ setEditingId(null); setFood(''); setCalories(''); setProteins(''); setFats(''); setCarbs(''); setBarcode(''); };

  // Copies Open Food Facts nutrition data into editable inputs without dropping zero values.
  const applyFood = (found)=>{
    setFood(found.name || '');
    setCalories(fieldValue(found.calories));
    setProteins(fieldValue(found.proteins));
    setFats(fieldValue(found.fats));
    setCarbs(fieldValue(found.carbs));
  };

  const loadVideoDevices = async ()=>{
    // Device labels are usually available only after camera permission is granted.
    if (!navigator.mediaDevices?.enumerateDevices) return;
    try {
      const devices = await navigator.mediaDevices.enumerateDevices();
      setVideoDevices(devices.filter((device) => device.kind === 'videoinput'));
    } catch (e) {
      console.debug('Could not enumerate cameras', e);
    }
  };

  const applyZoom = async (value)=>{
    // Browser support varies, but zoom can make small webcam barcodes much easier to read.
    const track = activeVideoTrackRef.current;
    if (!track || !track.applyConstraints || !zoomRange) return;
    const nextZoom = Number(value);
    setZoomValue(String(nextZoom));
    try {
      await track.applyConstraints({ advanced: [{ zoom: nextZoom }] });
    } catch (e) {
      console.debug('camera zoom ignored', e);
    }
  };

  // scanning
  const startScanner = async (cameraId = selectedCameraId)=>{
    // Request a high-resolution rear camera stream; browsers may downgrade unsupported constraints.
    if (!('mediaDevices' in navigator)) return alert('Camera not available');
    try{
      setBarcodeStatus('Starting camera...');
      stopScanner();
      const videoConstraint = cameraId
        ? { deviceId: { exact: cameraId } }
        : { facingMode: { ideal: 'environment' } };
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          ...videoConstraint,
          width: { ideal: 1920 },
          height: { ideal: 1080 },
          frameRate: { ideal: 30, max: 60 },
          advanced: [{ focusMode: 'continuous' }]
        },
        audio: false
      });
      setScanning(true);
      await new Promise(r=>setTimeout(r,50));
      if (!videoRef.current){ console.debug('videoRef missing'); return; }

      videoRef.current.srcObject = stream;
      videoRef.current.muted = true;
      videoRef.current.playsInline = true;
      videoRef.current.autoplay = true;
      try{ await videoRef.current.play(); }catch(e){ console.debug('video play error', e); }

      const [track] = stream.getVideoTracks();
      activeVideoTrackRef.current = track || null;
      if (track && track.getCapabilities && track.applyConstraints) {
        // Use continuous focus/exposure on browsers that expose camera capabilities.
        const capabilities = track.getCapabilities();
        const advanced = [];
        if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) advanced.push({ focusMode: 'continuous' });
        if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) advanced.push({ exposureMode: 'continuous' });
        if (capabilities.zoom) {
          const settings = track.getSettings ? track.getSettings() : {};
          const nextRange = {
            min: capabilities.zoom.min,
            max: capabilities.zoom.max,
            step: capabilities.zoom.step || 0.1
          };
          setZoomRange(nextRange);
          setZoomValue(String(settings.zoom || nextRange.min));
        } else {
          setZoomRange(null);
          setZoomValue('');
        }
        if (advanced.length) {
          try { await track.applyConstraints({ advanced }); } catch (e) { console.debug('camera constraints ignored', e); }
        }
      }
      await loadVideoDevices();

      setBarcodeStatus('Center the barcode in the frame. Use Lookup if scanning misses it.');
      const canvas = document.createElement('canvas');
      const formats = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code'];

      async function ensureZXing(){
        // Lazy-load ZXing only when scanning starts, configured for common food barcode formats.
        if (zxingRef.current) return zxingRef.current;
        try{
          const [browserMod, libraryMod] = await Promise.all([
            import('@zxing/browser'),
            import('@zxing/library')
          ]);
          const hints = new Map();
          hints.set(libraryMod.DecodeHintType.TRY_HARDER, true);
          hints.set(libraryMod.DecodeHintType.POSSIBLE_FORMATS, [
            libraryMod.BarcodeFormat.UPC_A,
            libraryMod.BarcodeFormat.UPC_E,
            libraryMod.BarcodeFormat.EAN_13,
            libraryMod.BarcodeFormat.EAN_8,
            libraryMod.BarcodeFormat.CODE_128,
            libraryMod.BarcodeFormat.CODE_39,
            libraryMod.BarcodeFormat.ITF,
            libraryMod.BarcodeFormat.CODABAR,
            libraryMod.BarcodeFormat.QR_CODE
          ]);
          zxingRef.current = new browserMod.BrowserMultiFormatReader(hints, {
            delayBetweenScanAttempts: 120,
            delayBetweenScanSuccess: 350
          });
          return zxingRef.current;
        }catch(e){ console.warn('ZXing import failed', e); return null; }
      }

      let detector = null;
      if ('BarcodeDetector' in window) {
        try {
          const supportedFormats = window.BarcodeDetector.getSupportedFormats
            ? await window.BarcodeDetector.getSupportedFormats()
            : formats;
          const nativeFormats = formats.filter((format)=>supportedFormats.includes(format));
          detector = new window.BarcodeDetector({ formats: nativeFormats.length ? nativeFormats : formats });
        } catch (e) {
          console.debug('Native BarcodeDetector unavailable for requested formats', e);
        }
      }

      const drawRegion = (v, region)=>{
        // Draw one normalized video region to a canvas for detector libraries that need image input.
        const w = v.videoWidth;
        const h = v.videoHeight;
        const source = {
          x: Math.max(0, Math.floor(region.x * w)),
          y: Math.max(0, Math.floor(region.y * h)),
          width: Math.min(w, Math.floor(region.width * w)),
          height: Math.min(h, Math.floor(region.height * h))
        };
        source.width = Math.min(source.width, w - source.x);
        source.height = Math.min(source.height, h - source.y);
        canvas.width = source.width;
        canvas.height = source.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(v, source.x, source.y, source.width, source.height, 0, 0, source.width, source.height);
        return canvas;
      };

      const rotateCanvas = (sourceCanvas)=>{
        // Some labels are scanned with the phone or package turned sideways, so try a 90-degree copy too.
        const rotated = document.createElement('canvas');
        rotated.width = sourceCanvas.height;
        rotated.height = sourceCanvas.width;
        const ctx = rotated.getContext('2d', { willReadFrequently: true });
        ctx.translate(rotated.width / 2, rotated.height / 2);
        ctx.rotate(Math.PI / 2);
        ctx.drawImage(sourceCanvas, -sourceCanvas.width / 2, -sourceCanvas.height / 2);
        return rotated;
      };

      const scanOnce = async ()=>{
        // Avoid overlapping decode work; slow phones can otherwise queue several frame scans at once.
        if (scanBusyRef.current) return null;
        scanBusyRef.current = true;
        try{
          const v = videoRef.current;
          if (!v || v.readyState < 2 || !v.videoWidth || !v.videoHeight) return null;

          if (detector) {
            try {
              const videoCodes = await detector.detect(v);
              if (videoCodes && videoCodes.length) return videoCodes[0].rawValue;
            } catch {}
          }

          const regions = [
            // Scan a range of shapes: full frame, long UPC/EAN strips, compact squares, and vertical labels.
            { x: 0, y: 0, width: 1, height: 1, rotate: false },
            { x: 0.03, y: 0.18, width: 0.94, height: 0.64, rotate: false },
            { x: 0.06, y: 0.28, width: 0.88, height: 0.44, rotate: false },
            { x: 0.08, y: 0.36, width: 0.84, height: 0.28, rotate: false },
            { x: 0.15, y: 0.40, width: 0.7, height: 0.2, rotate: false },
            { x: 0.18, y: 0.24, width: 0.64, height: 0.52, rotate: false },
            { x: 0.28, y: 0.22, width: 0.44, height: 0.56, rotate: true },
            { x: 0.34, y: 0.12, width: 0.32, height: 0.76, rotate: true },
            { x: 0.1, y: 0.12, width: 0.8, height: 0.76, rotate: true }
          ];

          const reader = await ensureZXing();
          if (reader) {
            try {
              const result = reader.decode(v);
              if (result && (result.text || result.getText)) return result.text || result.getText();
            } catch {}
          }
          for (const region of regions) {
            const frame = drawRegion(v, region);
            if (detector) {
              try {
                const bitmap = await createImageBitmap(frame);
                const codes = await detector.detect(bitmap);
                if (bitmap && bitmap.close) bitmap.close();
                if (codes && codes.length) return codes[0].rawValue;
              } catch {}
            }

            if (reader) {
              try {
                const result = await reader.decodeFromCanvas(frame);
                if (result && (result.text || result.getText)) return result.text || result.getText();
              } catch {}
              if (region.rotate) {
                try {
                  const rotatedFrame = rotateCanvas(frame);
                  const rotatedResult = await reader.decodeFromCanvas(rotatedFrame);
                  if (rotatedResult && (rotatedResult.text || rotatedResult.getText)) return rotatedResult.text || rotatedResult.getText();
                } catch {}
              }
            }
          }
          return null;
        } finally {
          scanBusyRef.current = false;
        }
      };

      scanIntervalRef.current = setInterval(async ()=>{
        // Poll quickly enough for responsive scanning without saturating the camera thread.
        const found = await scanOnce();
        if (found) {
          if (navigator.vibrate) navigator.vibrate(80);
          handleBarcode(found);
        }
      }, 180);
    }catch(ex){ alert('Could not access camera: '+ex.message); setBarcodeStatus('Camera could not start. Enter the barcode manually.'); }
  };

  const stopScanner = useCallback(()=>{
    // Stop all camera tracks so mobile browsers release the camera immediately.
    setScanning(false);
    if (scanIntervalRef.current){ clearInterval(scanIntervalRef.current); scanIntervalRef.current = null; }
    if (videoRef.current && videoRef.current.srcObject){ const tracks = videoRef.current.srcObject.getTracks(); tracks.forEach(t=>t.stop()); videoRef.current.srcObject = null; }
    activeVideoTrackRef.current = null;
    setZoomRange(null);
    setZoomValue('');
  },[]);

  useEffect(()=>()=>stopScanner(),[stopScanner]);

  const changeCamera = (cameraId)=>{
    // Switching cameras requires a fresh MediaStream, so restart scanning with the selected device.
    setSelectedCameraId(cameraId);
    if (scanning) {
      stopScanner();
      setTimeout(()=>startScanner(cameraId), 150);
    }
  };

  const lookupBarcode = async (code, addToLog = false)=>{
    // Normalize manual or scanned input before asking the backend/Open Food Facts for product data.
    const cleaned = String(code || '').replace(/\D/g, '');
    if (!cleaned) {
      setBarcodeStatus('Enter or scan a barcode first.');
      return null;
    }

    setBarcode(cleaned);
    setBarcodeStatus('Looking up product...');
    setBarcodeLoading(true);
    try{
      const r = await API.get(`/foods/barcode/${encodeURIComponent(cleaned)}`);
      const found = r.data;
      applyFood(found);

      if (addToLog) {
        // Scanner mode auto-adds the found product; manual Lookup only fills the editable form.
        const uid = user?.id || await ensureUser();
        const mealPayload = {
          user_id: uid,
          food_id: found.id || null,
          date,
          calories: numberOrNull(found.calories),
          proteins: numberOrNull(found.proteins),
          fats: numberOrNull(found.fats),
          carbs: numberOrNull(found.carbs)
        };
        await API.post('/meals', mealPayload);
        fetchMeals(selectedDate);
        showMessage(`Added ${found.name || cleaned}: ${hasValue(found.calories) ? found.calories : 0} kcal`);
        setBarcodeStatus(`Added ${found.name || 'product'} from Open Food Facts.`);
      } else {
        setBarcodeStatus(`Found ${found.name || 'product'} from Open Food Facts.`);
      }
      return found;
    }catch(e){
      const status = e?.response?.status;
      const error = e?.response?.data?.error || e.message || 'Lookup failed';
      if (status === 404) {
        setBarcodeStatus('Product not found in Open Food Facts. You can enter it manually.');
      } else if (status === 429) {
        setBarcodeStatus('Open Food Facts rate limit reached. Try again in a minute.');
      } else {
        setBarcodeStatus(`Barcode lookup failed: ${error}`);
      }
      console.error('Barcode lookup failed', e);
      return null;
    } finally {
      setBarcodeLoading(false);
    }
  };

  const handleBarcode = async (code)=>{
    // A successful scan should trigger one lookup, then stop the camera and show feedback.
    if (barcodeLookupRef.current) return;
    barcodeLookupRef.current = true;
    stopScanner();
    try {
      await lookupBarcode(code, true);
    } finally {
      barcodeLookupRef.current = false;
    }
  };

  const scanCurrentFrame = async ()=>{
    // Manual frame capture helps fixed-focus webcams after the user holds the barcode steady.
    const reader = zxingRef.current;
    const video = videoRef.current;
    if (!reader || !video || !video.videoWidth || !video.videoHeight) {
      setBarcodeStatus('Start the camera first, then hold the barcode still and capture.');
      return;
    }
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = reader.decodeFromCanvas(canvas);
      const code = result && (result.text || result.getText);
      if (code) handleBarcode(code);
      else setBarcodeStatus('No barcode found in that frame. Move the item farther back and try again.');
    } catch {
      setBarcodeStatus('No barcode found in that frame. Try more light or move the barcode farther from the webcam.');
    }
  };

  

  function showMessage(msg){ setMessage(msg); setTimeout(()=>setMessage(null),3500); }

  // Totals are derived from the visible entries so they always match the selected date.
  const totals = entries.reduce((acc,e)=>{ acc.calories += Number(e.calories)||0; acc.proteins += Number(e.proteins)||0; acc.fats += Number(e.fats)||0; acc.carbs += Number(e.carbs)||0; return acc; },{ calories:0, proteins:0, fats:0, carbs:0 });

  return (
    <div>
      {message && (
        <div className="toast-message">{message}</div>
      )}
      <h2 className="section-title">Calorie Tracker</h2>

      <div className="grid-2">
        <input className="input" placeholder="Food name" value={food} onChange={e=>setFood(e.target.value)} />
        <input className="input" placeholder="Calories" type="number" inputMode="decimal" value={calories} onChange={e=>setCalories(e.target.value)} />
        <input className="input" placeholder="Proteins (g)" type="number" inputMode="decimal" value={proteins} onChange={e=>setProteins(e.target.value)} />
        <input className="input" placeholder="Fats (g)" type="number" inputMode="decimal" value={fats} onChange={e=>setFats(e.target.value)} />
        <input className="input" placeholder="Carbs (g)" type="number" inputMode="decimal" value={carbs} onChange={e=>setCarbs(e.target.value)} />
        <input className="input" type="date" value={date} onChange={e=>setDate(e.target.value)} />
      </div>

      <div className="controls">
        <button className="btn btn-primary" onClick={addEntry}>Add Food</button>
        <div>
          <label className="entry-meta">View date:</label>
          <input className="small-input" type="date" value={selectedDate} onChange={e=>setSelectedDate(e.target.value)} />
        </div>
        <div className="footer-right">
          <input className="small-input" placeholder="Barcode" inputMode="numeric" value={barcode} onChange={e=>setBarcode(e.target.value)} />
            <button className="btn btn-ghost btn-small" onClick={()=>lookupBarcode(barcode, false)} disabled={barcodeLoading} type="button">
              {barcodeLoading ? 'Looking...' : 'Lookup'}
            </button>
            {!scanning ? (
              <button className="btn btn-scan btn-small" onClick={()=>startScanner()}>Scan</button>
            ) : (
              <button className="btn btn-ghost btn-small" onClick={stopScanner}>Stop</button>
            )}
        </div>
      </div>
      {barcodeStatus && <div className="barcode-status">{barcodeStatus}</div>}

      {scanning && (
        <div className="scanner-preview">
          <video ref={videoRef} className="video-responsive" autoPlay muted playsInline />
          <div className="scan-frame" aria-hidden="true"><span /></div>
          <div className="scanner-tools">
            {videoDevices.length > 1 && (
              <select
                className="small-input"
                value={selectedCameraId}
                onChange={(event)=>changeCamera(event.target.value)}
                aria-label="Camera"
              >
                <option value="">Auto camera</option>
                {videoDevices.map((device, index)=>(
                  <option key={device.deviceId} value={device.deviceId}>
                    {device.label || `Camera ${index + 1}`}
                  </option>
                ))}
              </select>
            )}
            {zoomRange && (
              <label className="zoom-control">
                <span>Zoom</span>
                <input
                  type="range"
                  min={zoomRange.min}
                  max={zoomRange.max}
                  step={zoomRange.step}
                  value={zoomValue}
                  onChange={(event)=>applyZoom(event.target.value)}
                />
              </label>
            )}
            <button className="btn btn-ghost btn-small" onClick={scanCurrentFrame} type="button">
              Capture frame
            </button>
          </div>
        </div>
      )}

      <div className="totals-card">
        <div style={{ display:'flex', justifyContent:'space-between' }}>
          <div>
            <div className="entry-meta">Date</div>
            <div className="font-medium">{formatDate(selectedDate)}</div>
          </div>
          <div style={{ textAlign:'right' }}>
            <div className="entry-meta">Calories</div>
            <div className="font-medium">{totals.calories}</div>
          </div>
        </div>
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap: '0.75rem', marginTop:'0.75rem', fontSize:'0.9rem' }}>
          <div>Proteins: {totals.proteins} g</div>
          <div>Fats: {totals.fats} g</div>
          <div>Carbs: {totals.carbs} g</div>
        </div>
      </div>

      <ul className="entry-list">
        {entries.map(e=> (
          <li key={e.id} className="entry-item">
            <div>
              <div className="font-medium">{e.food_name || e.note || 'Food'}: {hasValue(e.calories) ? e.calories : ''} kcal</div>
              <div className="entry-meta">P {e.proteins || 0}g | F {e.fats || 0}g | C {e.carbs || 0}g</div>
            </div>
            <div style={{ display:'flex', gap:'0.5rem', alignItems:'center' }}>
              <div className="entry-meta">{formatDate(e.date)}</div>
              {editingId === e.id ? (
                <>
                  <button className="btn btn-primary btn-small" onClick={addEntry}>Done</button>
                  <button className="btn btn-ghost btn-small" onClick={cancelEdit}>Cancel</button>
                </>
              ) : (
                <>
                  <button className="btn btn-warning btn-small" onClick={()=>startEdit(e)}>Edit</button>
                  <button className="btn btn-danger btn-small" onClick={()=>deleteEntry(e.id)}>Delete</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}



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

  const videoRef = useRef(null);
  // Refs hold scanner resources without causing render loops while frames are decoded.
  const scanIntervalRef = useRef(null);
  const scanBusyRef = useRef(false);
  const zxingRef = useRef(null);
  const barcodeLookupRef = useRef(false);
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

  // scanning
  const startScanner = async ()=>{
    // Request a high-resolution rear camera stream; browsers may downgrade unsupported constraints.
    if (!('mediaDevices' in navigator)) return alert('Camera not available');
    try{
      setBarcodeStatus('Starting camera...');
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
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
      if (track && track.getCapabilities && track.applyConstraints) {
        // Use continuous focus/exposure on browsers that expose camera capabilities.
        const capabilities = track.getCapabilities();
        const advanced = [];
        if (capabilities.focusMode && capabilities.focusMode.includes('continuous')) advanced.push({ focusMode: 'continuous' });
        if (capabilities.exposureMode && capabilities.exposureMode.includes('continuous')) advanced.push({ exposureMode: 'continuous' });
        if (advanced.length) {
          try { await track.applyConstraints({ advanced }); } catch (e) { console.debug('camera constraints ignored', e); }
        }
      }

      setBarcodeStatus('Center the barcode in the frame. Use Lookup if scanning misses it.');
      const canvas = document.createElement('canvas');
      const formats = ['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code'];

      async function ensureZXing(){
        // Lazy-load ZXing only when scanning starts so normal calorie tracking loads faster.
        if (zxingRef.current) return zxingRef.current;
        try{
          const mod = await import('@zxing/browser');
          zxingRef.current = new mod.BrowserMultiFormatReader();
          return zxingRef.current;
        }catch(e){ console.warn('ZXing import failed', e); return null; }
      }

      const detector = ('BarcodeDetector' in window) ? new window.BarcodeDetector({ formats }) : null;

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
            // Try the full frame first, then barcode-shaped regions that improve detection on mobile.
            { x: 0, y: 0, width: 1, height: 1 },
            { x: 0.08, y: 0.28, width: 0.84, height: 0.44 },
            { x: 0.14, y: 0.36, width: 0.72, height: 0.28 },
            { x: 0.25, y: 0.08, width: 0.5, height: 0.84 }
          ];

          const reader = await ensureZXing();
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
  },[]);

  useEffect(()=>()=>stopScanner(),[stopScanner]);

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
              <button className="btn btn-scan btn-small" onClick={startScanner}>Scan</button>
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


import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Camera as CameraIcon, Video, Zap, ZapOff, Aperture, FlipHorizontal, Maximize, Circle, Square, Image as ImageIcon, Settings, Palette, Menu, Grid3x3, Target, SlidersHorizontal, RefreshCcw, Scan, Hand, Sparkles, MoreHorizontal, Camera } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const FILTERS = [
  { name: 'Normal', css: 'none' },
  { name: 'Vivid', css: 'contrast(120%) saturate(130%)' },
  { name: 'Vivid Warm', css: 'contrast(120%) saturate(130%) sepia(20%)' },
  { name: 'Vivid Cool', css: 'contrast(120%) saturate(130%) hue-rotate(-10deg)' },
  { name: 'Dramatic', css: 'contrast(150%) brightness(80%) saturate(110%)' },
  { name: 'Dramatic Warm', css: 'contrast(150%) brightness(80%) saturate(110%) sepia(30%)' },
  { name: 'Dramatic Cool', css: 'contrast(150%) brightness(80%) saturate(110%) hue-rotate(-15deg)' },
  { name: 'Mono', css: 'grayscale(100%)' },
  { name: 'Silvertone', css: 'grayscale(100%) contrast(120%) brightness(110%) sepia(10%) hue-rotate(180deg)' },
  { name: 'Noir', css: 'grayscale(100%) contrast(150%) brightness(80%)' }
];

type FlashMode = 'auto' | 'on' | 'off';

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [hasPermission, setHasPermission] = useState<boolean | null>(null);
  const [mode, setMode] = useState<'photo' | 'video'>('photo');
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [flashMode, setFlashMode] = useState<FlashMode>('auto');
  const [isGridActive, setIsGridActive] = useState(false);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [actualHardwareZoom, setActualHardwareZoom] = useState(1.0);
  const zoomAnimationRef = useRef<number | null>(null);
  const [isSmartZoomActive, setIsSmartZoomActive] = useState(false);
  const [activeFilterIndex, setActiveFilterIndex] = useState(0);
  const [showFilters, setShowFilters] = useState(false);
  const [lastCapture, setLastCapture] = useState<string | null>(null);
  const [capabilities, setCapabilities] = useState<any>(null);
  const [showShutterFlash, setShowShutterFlash] = useState(false);
  const [activeTab, setActiveTab] = useState('PHOTO');
  const [bottomNavTab, setBottomNavTab] = useState('AI ZOOM');

  const [focusPoint, setFocusPoint] = useState<{ x: number, y: number } | null>(null);
  const [showFocusBox, setShowFocusBox] = useState(false);
  const [focusBoxPos, setFocusBoxPos] = useState({ x: 0, y: 0 });

  // Initialize camera
  const startCamera = useCallback(async () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      // Wait for hardware to fully release the camera
      await new Promise(resolve => setTimeout(resolve, 150));
    }

    try {
      let stream: MediaStream;
      // Simplified audio access
      const audioConstraints = true;

      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facingMode } },
          audio: audioConstraints
        });
      } catch (initialErr) {
        console.warn("Initial camera request failed, trying fallback with resolutions", initialErr);
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1080 } },
            audio: audioConstraints
          });
        } catch (secondErr) {
          console.warn("Second camera request failed, trying without audio and specific constraints", secondErr);
          stream = await navigator.mediaDevices.getUserMedia({
            video: true,
            audio: false
          });
        }
      }

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      streamRef.current = stream;
      setHasPermission(true);

      const track = stream.getVideoTracks()[0];
      if (track.getCapabilities) {
        setCapabilities(track.getCapabilities());
      }
    } catch (err) {
      console.error("Error accessing camera:", err);
      setHasPermission(false);
    }
  }, [facingMode, mode]);

  useEffect(() => {
    startCamera();
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
      }
    };
  }, [startCamera]);

  // Apply Flash/Torch and Zoom when they change
  useEffect(() => {
    if (!streamRef.current) return;
    const track = streamRef.current.getVideoTracks()[0];
    if (track && track.readyState === 'live' && capabilities) {
      const constraints: any = { advanced: [{}] };
      if (capabilities.torch) {
        constraints.advanced[0].torch = flashMode === 'on';
      }
      
      let targetZ: number | null = null;
      if (capabilities.zoom) {
        // Ensure zoom is within bounds natively supported
        targetZ = Math.max(capabilities.zoom.min || 1, Math.min(zoomLevel, capabilities.zoom.max || zoomLevel));
        const currentZ = track.getSettings().zoom;
        
        // We only queue a constraint if it's meaningfully different
        // to avoid spamming the camera driver with micro-adjustments
        if (currentZ === undefined || Math.abs(currentZ - targetZ) > 0.05) {
          constraints.advanced[0].zoom = targetZ;
        }
      }
      
      if (capabilities.focusMode && focusPoint) {
        constraints.advanced[0].focusMode = 'continuous';
        // Set pointsOfInterest
        constraints.advanced[0].pointsOfInterest = [{ x: focusPoint.x, y: focusPoint.y }];
      }
      
      if (Object.keys(constraints.advanced[0]).length > 0) {
        track.applyConstraints(constraints)
          .then(() => {
             const settings = track.getSettings();
             if (settings.zoom !== undefined) {
               setActualHardwareZoom(settings.zoom);
             } else if (targetZ !== null) {
               setActualHardwareZoom(targetZ);
             }
          })
          .catch(e => {
            console.warn("Constraints not supported or track invalid", e);
          });
      }
    }
  }, [flashMode, zoomLevel, capabilities, mode, focusPoint]);

  // Simulated AI Smart Zoom loop (since ML Kit isn't available on web)
  useEffect(() => {
    if (!isSmartZoomActive) return;
    
    let timeout: NodeJS.Timeout;
    
    const smartZoomDecide = () => {
      setZoomLevel(prev => {
        // Cameraman behavior: mostly hold the shot, occasionally adjust zoom
        const action = Math.random();
        
        // 70% chance to just hold the current zoom level
        if (action < 0.7) {
          timeout = setTimeout(smartZoomDecide, 2000 + Math.random() * 3000);
          return prev;
        }

        // 30% chance to adjust zoom
        // Favor zooming in slightly if we are zoomed out, or zooming out if we are zoomed in
        const max = capabilities?.zoom?.max ? Math.min(3, capabilities.zoom.max) : 3;
        const min = capabilities?.zoom?.min || 1;
        const range = max - min;
        
        // Find center of range. If we are below center, more likely to zoom in.
        const center = min + (range / 2);
        let direction = prev < center ? 1 : -1;
        
        // Add some randomness so it's not totally predictable
        if (Math.random() > 0.8) {
          direction *= -1;
        }
        
        // Zoom amount between 0.3x and 1.2x
        const amount = 0.3 + Math.random() * 0.9;
        const newZoom = prev + (amount * direction);
        
        const target = Math.max(min, Math.min(newZoom, max));
        smoothZoomTo(target);
        
        // After making a move, wait longer so the shot settles
        timeout = setTimeout(smartZoomDecide, 4000 + Math.random() * 4000);
        return prev; // smoothZoomTo handles the actual state transition
      });
    };
    
    // Initial delay before first move
    timeout = setTimeout(smartZoomDecide, 2000 + Math.random() * 2000);

    return () => clearTimeout(timeout);
  }, [isSmartZoomActive, capabilities]);

  // Recording Timer
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isRecording) {
      interval = setInterval(() => setRecordingTime(prev => prev + 1), 1000);
    } else {
      setRecordingTime(0);
    }
    return () => clearInterval(interval);
  }, [isRecording]);

  const toggleFlash = () => {
    setFlashMode(prev => prev === 'auto' ? 'on' : prev === 'on' ? 'off' : 'auto');
  };

  const handleCapture = () => {
    if (mode === 'photo') {
      const dataUrl = takePhoto();
      if (dataUrl) {
        const link = document.createElement('a');
        link.href = dataUrl;
        link.download = `OdaCamera_PRO_${Date.now()}.jpg`;
        link.click();
      }
    } else {
      toggleRecording();
    }
  };

  const smoothZoomTo = (target: number) => {
    if (zoomAnimationRef.current !== null) {
      cancelAnimationFrame(zoomAnimationRef.current);
    }
    
    // Instead of using complicated timing, a simple lerp works well for zoom
    const animate = () => {
      setZoomLevel(prev => {
        const diff = target - prev;
        if (Math.abs(diff) < 0.05) {
          zoomAnimationRef.current = null;
          return target;
        }
        zoomAnimationRef.current = requestAnimationFrame(animate);
        return prev + diff * 0.15; // lerp ease-out
      });
    };
    zoomAnimationRef.current = requestAnimationFrame(animate);
  };

  const takePhoto = () => {
    if (!videoRef.current || !canvasRef.current) return;
    
    // UI Flash
    setShowShutterFlash(true);
    setTimeout(() => setShowShutterFlash(false), 100);

    const video = videoRef.current;
    const canvas = canvasRef.current;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    
    if (ctx) {
      const w = canvas.width / digitalZoom;
      const h = canvas.height / digitalZoom;
      const x = (canvas.width - w) / 2;
      const y = (canvas.height - h) / 2;

      // Handle mirroring for front camera
      if (facingMode === 'user') {
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
      }
      if (mode === 'photo') {
        ctx.filter = FILTERS[activeFilterIndex].css;
      }
      ctx.drawImage(video, x, y, w, h, 0, 0, canvas.width, canvas.height);
      ctx.filter = 'none';
      const dataUrl = canvas.toDataURL('image/jpeg', 0.95);
      setLastCapture(dataUrl);
      
      return dataUrl; // Return for analysis
    }
  };

  const analyzeScene = async () => {
    const dataUrl = takePhoto();
    if (!dataUrl) return;

    // Simulate AI scene detection call
    console.log("Analyzing scene...");
    // @ts-ignore
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    
    // ... logic for AI analysis ...
    console.log("AI analysis complete.");
    // Apply changes... reset zoom, etc.
    setZoomLevel(1.0);
    smoothZoomTo(1.0);
  };

  const toggleRecording = () => {
    if (isRecording) {
      if(mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      setIsRecording(false);
      setIsSmartZoomActive(false); // Stop auto zoom when recording stops
    } else {
      if (!streamRef.current) return;
      chunksRef.current = [];
      let options: any = undefined;
      // Provide robust mime types that ensure both video and audio are recorded if supported
      if (typeof MediaRecorder !== 'undefined') {
        const types = [
          'video/webm;codecs=vp8,opus',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=h264,opus',
          'video/mp4;codecs=h264,aac',
          'video/webm',
          'video/mp4'
        ];
        for (const t of types) {
          if (MediaRecorder.isTypeSupported(t)) {
            options = { mimeType: t };
            break;
          }
        }
      }
      
      try {
        const mediaRecorder = options ? new MediaRecorder(streamRef.current, options) : new MediaRecorder(streamRef.current);
        
        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunksRef.current.push(e.data);
        };
        
        mediaRecorder.onstop = () => {
          const type = options?.mimeType || 'video/webm';
          const ext = type.includes('mp4') ? 'mp4' : 'webm';
          const blob = new Blob(chunksRef.current, { type });
          const url = URL.createObjectURL(blob);
          setLastCapture(url);
          
          const link = document.createElement('a');
          link.href = url;
          link.download = `OdaCamera_PRO_${Date.now()}.${ext}`;
          link.click();
        };

        mediaRecorderRef.current = mediaRecorder;
        mediaRecorder.start();
        setIsRecording(true);
        
        // Auto-start smart zoom when recording a cinematic video
        if (mode === 'video') {
          setIsSmartZoomActive(true);
        }
      } catch (err) {
        console.error("Failed to start MediaRecorder:", err);
      }
    }
  };

  const handleTapToFocus = (e: React.MouseEvent<HTMLDivElement>) => {
    // Only set focus manually if not clicking a button/input
    const target = e.target as HTMLElement;
    if (target.closest('button') || target.closest('input')) {
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    setFocusBoxPos({ x, y });
    setShowFocusBox(true);

    const hwZoomRender = capabilities?.zoom ? Math.max(capabilities.zoom.min || 1, Math.min(actualHardwareZoom, capabilities.zoom.max || 1)) : 1;
    const swZoomRender = Math.max(1, zoomLevel / hwZoomRender);
    const scale = swZoomRender;
    
    let rx = x / rect.width;
    let ry = y / rect.height;
    
    rx = 0.5 + (rx - 0.5) / scale;
    ry = 0.5 + (ry - 0.5) / scale;

    if (facingMode === 'user') {
       rx = 1 - rx;
    }

    setFocusPoint({ x: rx, y: ry });
    
    setTimeout(() => {
      setShowFocusBox(false);
    }, 2000);
  };

  const formatTime = (seconds: number) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const maxHardwareZoom = capabilities?.zoom?.max || 1;
  const hardwareZoom = capabilities?.zoom ? Math.min(actualHardwareZoom, maxHardwareZoom) : 1;
  const digitalZoom = zoomLevel / hardwareZoom;
  const scaleX = facingMode === 'user' ? -digitalZoom : digitalZoom;

  if (hasPermission === false) {
    return (
      <div className="flex h-screen w-full items-center justify-center bg-black text-white p-6 text-center focus-mode">
        <div className="space-y-4 max-w-md">
          <Aperture size={48} className="mx-auto text-yellow-400" />
          <h1 className="text-xl font-bold">Camera Access Required</h1>
          <p className="text-white/60 text-sm">Please allow camera and microphone permissions in your browser settings to use OdaCamera Pro.</p>
          <button onClick={startCamera} className="px-6 py-2 bg-yellow-400 text-black font-bold rounded-full">Retry Permission</button>
        </div>
      </div>
    );
  }

  const hwZoomRender = capabilities?.zoom ? Math.max(capabilities.zoom.min || 1, Math.min(actualHardwareZoom, capabilities.zoom.max || 1)) : 1;
  const swZoomRender = Math.max(1, zoomLevel / hwZoomRender);

  return (
    <div className="flex flex-col h-[100dvh] w-full bg-black text-white font-sans overflow-hidden relative selection:bg-yellow-500/30">
      {/* Hidden Canvas for Photo Processing */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Main Viewfinder */}
      <div 
        className="relative flex-1 bg-neutral-900 w-full overflow-hidden" 
        onClick={handleTapToFocus}
      >
        <video 
          ref={videoRef}
          className={`w-full h-full object-cover`}
          style={{ 
            filter: mode === 'photo' ? FILTERS[activeFilterIndex].css : 'none',
            transform: `scale(${swZoomRender}) ${facingMode === 'user' ? 'scaleX(-1)' : ''}`
          }}
          autoPlay 
          playsInline 
          muted
        />

        <AnimatePresence>
          {isGridActive && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 pointer-events-none z-10 opacity-30"
            >
              <div className="absolute inset-0 flex flex-col justify-evenly">
                <div className="w-full h-[1px] bg-white mix-blend-overlay shadow-[0_1px_1px_rgba(0,0,0,0.5)]"></div>
                <div className="w-full h-[1px] bg-white mix-blend-overlay shadow-[0_1px_1px_rgba(0,0,0,0.5)]"></div>
              </div>
              <div className="absolute inset-0 flex justify-evenly">
                <div className="h-full w-[1px] bg-white mix-blend-overlay shadow-[1px_0_1px_rgba(0,0,0,0.5)]"></div>
                <div className="h-full w-[1px] bg-white mix-blend-overlay shadow-[1px_0_1px_rgba(0,0,0,0.5)]"></div>
              </div>
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-4 h-4 text-white/50 border border-white/40 flex items-center justify-center">
                <div className="w-1 h-1 bg-white/70 rounded-full"></div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Focus Box Overlay */}
        <AnimatePresence>
          {showFocusBox && (
            <motion.div
              initial={{ scale: 1.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ opacity: 0 }}
              key={focusPoint ? focusPoint.x + focusPoint.y : 'focus'}
              className="absolute pointer-events-none z-40"
              style={{
                top: focusBoxPos.y - 60,
                left: focusBoxPos.x - 60,
                width: 120,
                height: 120
              }}
            >
              {/* Corner brackets */}
              <div className="absolute top-0 left-0 w-8 h-8 focus-corner border-t-[3px] border-l-[3px] border-[#ccff00] rounded-tl-lg"></div>
              <div className="absolute top-0 right-0 w-8 h-8 focus-corner border-t-[3px] border-r-[3px] border-[#ccff00] rounded-tr-lg"></div>
              <div className="absolute bottom-0 left-0 w-8 h-8 focus-corner border-b-[3px] border-l-[3px] border-[#ccff00] rounded-bl-lg"></div>
              <div className="absolute bottom-0 right-0 w-8 h-8 focus-corner border-b-[3px] border-r-[3px] border-[#ccff00] rounded-br-lg"></div>
              
              <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-2 h-2 bg-[#ccff00] rounded-full shadow-[0_0_10px_#ccff00]"></div>
            </motion.div>
          )}
        </AnimatePresence>
        
        {/* Shutter Animation Overlay */}
        <AnimatePresence>
          {showShutterFlash && (
            <motion.div 
              initial={{ opacity: 1 }}
              animate={{ opacity: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3 }}
              className="absolute inset-0 bg-white z-50 pointer-events-none"
            />
          )}
        </AnimatePresence>

        {/* Cinematic Top/Bottom Gradients */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-black/60 pointer-events-none z-10"></div>

        {/* Top Controls */}
        <div className="absolute top-0 left-0 w-full z-20 p-6 flex justify-between items-start pt-[max(env(safe-area-inset-top),32px)] text-white">
          <button className="w-12 h-12 rounded-full bg-[#1a1a1a]/80 backdrop-blur-md flex items-center justify-center border border-white/10 hover:bg-[#2a2a2a]/80 transition-colors">
            <Menu size={24} />
          </button>
          
          {isRecording ? (
            <div className="flex items-center gap-3 bg-[#1a1a1a]/80 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/5">
              <div className="flex items-center gap-2">
                <div className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse"></div>
                <span className="text-xs font-bold text-red-500 tracking-widest">REC</span>
              </div>
              <span className="font-mono text-sm tracking-wider w-[4.5rem]">{formatTime(recordingTime)}</span>
              <div className="h-4 w-px bg-white/20 mx-1"></div>
              <span className="text-xs font-semibold text-white/50 tracking-wider">4K • 30</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 bg-[#1a1a1a]/80 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/5 invisible">
              {/* Invisible placeholder to keep alignment */}
              <span className="font-mono text-sm tracking-wider">00:00:00</span>
            </div>
          )}

          <button className="w-12 h-12 rounded-full bg-[#1a1a1a]/80 backdrop-blur-md flex items-center justify-center border border-white/10 hover:bg-[#2a2a2a]/80 transition-colors relative">
            <Settings size={22} />
            <div className="absolute top-3 right-3 w-1.5 h-1.5 rounded-full bg-[#ccff00]"></div>
          </button>
        </div>

        {/* AI Zoom Badge */}
        <AnimatePresence>
          {isSmartZoomActive && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-32 left-1/2 -translate-x-1/2 z-20"
            >
              <div className="px-5 py-2 rounded-full border border-[#ccff00] bg-[#1a1a1a]/80 backdrop-blur-md flex items-center gap-2 shadow-[0_0_15px_rgba(204,255,0,0.15)]">
                <Scan size={14} className="text-[#ccff00]" />
                <span className="text-[10px] font-bold text-[#ccff00] tracking-widest">AI AUTO-ZOOM ACTIVE</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Left Controls */}
        <div className="absolute left-6 top-32 z-20 flex flex-col gap-4">
          <button 
            className="w-12 h-14 rounded-full bg-[#1a1a1a]/80 backdrop-blur-md flex flex-col items-center justify-center gap-1 border border-white/10"
            onClick={analyzeScene}
          >
            <Sparkles size={18} className="text-[#ccff00]" />
            <span className="text-[8px] font-bold tracking-widest text-[#ccff00]">AI</span>
          </button>
          <button 
            className="w-12 h-14 rounded-full bg-[#1a1a1a]/80 backdrop-blur-md flex flex-col items-center justify-center gap-1 border border-white/10"
          >
            <Target size={18} className="text-white" />
            <span className="text-[8px] font-bold tracking-widest text-white/70">FOCUS</span>
          </button>
          <button 
            onClick={() => setIsGridActive(!isGridActive)}
            className={`w-12 h-14 rounded-full backdrop-blur-md flex flex-col items-center justify-center gap-1 border transition-colors ${isGridActive ? 'bg-white/20 border-white/30 text-white' : 'bg-[#1a1a1a]/80 border-white/10 text-white/70'}`}
          >
            <Grid3x3 size={18} />
            <span className="text-[8px] font-bold tracking-widest">GRID</span>
          </button>
          <button 
            onClick={toggleFlash}
            className={`w-12 h-14 rounded-full backdrop-blur-md flex flex-col items-center justify-center gap-1 border transition-colors ${flashMode === 'on' ? 'bg-[#ccff00]/20 border-[#ccff00]/50 text-[#ccff00]' : 'bg-[#1a1a1a]/80 border-white/10 text-white/70'}`}
          >
            {flashMode === 'auto' ? <span className="text-[8px] font-bold tracking-widest">AUTO</span> : flashMode === 'off' ? <ZapOff size={18} /> : <Zap size={18} />}
            {flashMode !== 'auto' && <span className="text-[8px] font-bold tracking-widest">{flashMode === 'off' ? 'OFF' : 'ON'}</span>}
          </button>
        </div>

        {/* Filters Overlay */}
        <AnimatePresence>
          {showFilters && mode === 'photo' && (
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.2 }}
              className="absolute top-[100px] left-0 w-full z-20 px-6 pt-2"
            >
              <div className="flex gap-3 overflow-x-auto pb-4 scrollbar-hide snap-x relative z-30 pointer-events-auto">
                {FILTERS.map((filter, idx) => (
                  <button
                    key={filter.name}
                    onClick={() => setActiveFilterIndex(idx)}
                    className={`snap-center shrink-0 w-[5.5rem] h-[6.5rem] rounded-xl border border-[#333] flex flex-col overflow-hidden transition-all ${
                      activeFilterIndex === idx ? 'border-yellow-400 shadow-[0_0_10px_rgba(250,204,21,0.2)] scale-105 relative z-10' : 'opacity-70 hover:opacity-100'
                    }`}
                  >
                    <div className="flex-1 bg-black/40 overflow-hidden relative flex items-center justify-center">
                      <div className="absolute inset-0 bg-neutral-400" style={{ filter: filter.css !== 'none' ? filter.css : undefined }}>
                        <div className="w-full h-full bg-[url('https://images.unsplash.com/photo-1492691527719-9d1e07e534b4?q=80&w=200&auto=format&fit=crop')] bg-cover bg-center"></div>
                      </div>
                    </div>
                    <div className={`h-7 flex items-center justify-center text-[9px] font-bold uppercase tracking-wider ${activeFilterIndex === idx ? 'bg-yellow-400 text-black' : 'bg-[#111] text-white/70'}`}>
                      {filter.name}
                    </div>
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dynamic Zoom Display */}
        <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col items-center gap-4">
           <div className="camera-glass px-2 py-6 rounded-full flex flex-col items-center justify-center shadow-xl relative">
             
             <div className="zoom-slider-container">
               <div className="dots">
                 <span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span>
               </div>
               <input 
                 type="range" 
                 min={1} 
                 max={25} 
                 step={0.1}
                 value={zoomLevel} 
                 onChange={(e) => {
                    if (zoomAnimationRef.current) cancelAnimationFrame(zoomAnimationRef.current);
                    setZoomLevel(parseFloat(e.target.value));
                 }}
                 className="zoom-slider relative z-10"
               />
               
               <div 
                 className="absolute left-[50%] -translate-x-[50%] w-[52px] h-[52px] flex items-center justify-center pointer-events-none z-20 text-[#ccff00] font-mono font-medium text-[16px] tracking-tight bg-[#222]/90 border border-[#ccff00] rounded-full shadow-[0_0_15px_rgba(204,255,0,0.2)]"
                 style={{ bottom: `${16 + ((zoomLevel - 1) / 24) * 128}px`, marginBottom: '-26px' }}
               >
                 {zoomLevel.toFixed(1)}x
               </div>
             </div>

           </div>
        </div>
        {/* Smart Zoom Toast */}
        <AnimatePresence>
          {isSmartZoomActive && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20"
            >
              <div className="bg-[#1a1a1a]/80 backdrop-blur-md px-5 py-3.5 rounded-[1.25rem] border border-white/5 flex items-center gap-4 shadow-xl">
                <Scan size={24} className="text-[#ccff00]" />
                <div>
                  <div className="text-xs font-bold text-white mb-0.5">Tracking subject</div>
                  <div className="text-[10px] text-white/50">Zooming for better detail</div>
                  <div className="flex gap-1 mt-2">
                    <div className="w-2.5 h-1 bg-[#ccff00] rounded-full"></div>
                    <div className="w-2.5 h-1 bg-[#ccff00]/60 rounded-full"></div>
                    <div className="w-2.5 h-1 bg-[#ccff00]/30 rounded-full"></div>
                    <div className="w-2.5 h-1 bg-white/20 rounded-full"></div>
                    <div className="w-2.5 h-1 bg-white/20 rounded-full"></div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

      </div>

      {/* Bottom Controls Area */}
      <div className="relative z-30 flex flex-col bg-black">
        
        {/* Main Camera Controls Card */}
        <div className="bg-[#0f0f0f] rounded-t-[2rem] rounded-b-[1rem] px-2 py-6 mx-2 border border-white/5 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-20">
          
          {/* Mode Selector */}
          <div className="flex justify-center gap-8 mb-6 text-[10px] sm:text-[11px] font-bold uppercase tracking-widest w-full border-b border-white/5 pb-5">
            {['SMART', 'VIDEO', 'PHOTO', 'PORTRAIT'].map((t) => (
              <button 
                key={t}
                onClick={() => {
                  setActiveTab(t);
                  if (t === 'VIDEO' || t === 'SMART') setMode('video');
                  else setMode('photo');
                  if (t === 'SMART') setIsSmartZoomActive(true);
                  else setIsSmartZoomActive(false);
                }}
                className={`transition-colors relative pb-1 ${activeTab === t ? 'text-[#ccff00]' : 'text-white/50'}`}
              >
                {t}
                {activeTab === t && <div className="absolute -bottom-[21px] left-1/2 -translate-x-1/2 w-8 h-[2px] bg-[#ccff00]"></div>}
              </button>
            ))}
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between w-full px-2 sm:px-6">
            
            <div className="flex items-center gap-2 sm:gap-4">
              <button className="flex flex-col items-center gap-2 opacity-80 hover:opacity-100 transition-opacity w-14">
                <div className="w-12 h-12 rounded-full bg-[#1a1a1a] border border-[#333] overflow-hidden relative group">
                  {lastCapture ? (
                    mode === 'video' ? (
                      <div className="w-full h-full bg-[#222] flex items-center justify-center">
                        <Video size={16} className="text-white/50" />
                      </div>
                    ) : (
                      <img src={lastCapture} alt="Last capture" className="w-full h-full object-cover" />
                    )
                  ) : (
                    <div className="w-full h-full flex items-center justify-center bg-[url('https://images.unsplash.com/photo-1544256718-3baf237f39d0?q=80&w=200&auto=format&fit=crop')] bg-cover bg-center">
                    </div>
                  )}
                </div>
                <span className="text-[8px] font-bold tracking-widest text-[white]/60 uppercase">Gallery</span>
              </button>
              
              <button onClick={() => setShowFilters(!showFilters)} className="flex flex-col items-center gap-2 opacity-80 hover:opacity-100 transition-opacity w-14">
                 <div className="w-12 h-12 rounded-full bg-[#1a1a1a] flex items-center justify-center border border-[#333]">
                   <SlidersHorizontal size={18} className="text-white" />
                 </div>
                 <span className="text-[8px] font-bold tracking-widest text-[#white]/60 uppercase">Style</span>
              </button>
            </div>

            {/* Main Shutter/Record Button */}
            <button 
              onClick={handleCapture}
              className="w-[5.5rem] h-[5.5rem] rounded-full border-4 border-white/20 p-1 flex items-center justify-center relative active:scale-95 transition-all outline-none"
            >
              <div className="absolute inset-0 rounded-full border-[1.5px] border-dashed border-white/10 m-[-6px] animate-[spin_10s_linear_infinite]"></div>
              <div className={`w-full h-full rounded-full transition-all duration-300 ${
                mode === 'video' 
                  ? (isRecording ? 'bg-red-500 rounded-xl scale-[0.45]' : 'bg-red-500 shadow-[0_0_20px_rgba(239,68,68,0.4)]') 
                  : 'bg-[#ccff00] shadow-[0_0_20px_rgba(204,255,0,0.3)]'
              }`}></div>
            </button>

            <div className="flex items-center gap-2 sm:gap-4">
              <button onClick={() => setFacingMode(prev => prev === 'environment' ? 'user' : 'environment')} className="flex flex-col items-center gap-2 opacity-80 hover:opacity-100 transition-opacity w-14">
                 <div className="w-12 h-12 rounded-full bg-[#1a1a1a] flex items-center justify-center border border-[#333]">
                   <RefreshCcw size={18} className="text-white" />
                 </div>
                 <span className="text-[8px] font-bold tracking-widest text-white/60 uppercase">Switch</span>
              </button>
              
              <button onClick={handleCapture} className="flex flex-col items-center gap-2 opacity-80 hover:opacity-100 transition-opacity w-14">
                 <div className="w-12 h-12 rounded-full bg-[#1a1a1a] flex items-center justify-center border border-[#333]">
                   <CameraIcon size={18} className="text-white" />
                 </div>
                 <span className="text-[8px] font-bold tracking-widest text-white/60 uppercase">Capture</span>
              </button>
            </div>
            
          </div>
        </div>

        {/* Bottom Tab Bar */}
        <div className="flex justify-between items-center w-full px-6 pt-5 pb-8 overflow-x-auto scrollbar-hide z-10" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 32px)' }}>
          {[
            { id: 'AI ZOOM', icon: Scan },
            { id: 'STABILIZE', icon: Hand },
            { id: 'BEAUTY', icon: Sparkles },
            { id: 'FILTER', icon: Aperture },
            { id: 'MORE', icon: MoreHorizontal }
          ].map(({ id, icon: Icon }) => (
             <button 
               key={id}
               onClick={() => setBottomNavTab(id)}
               className={`flex flex-col items-center gap-1.5 transition-colors px-2 shrink-0 ${bottomNavTab === id ? 'text-[#ccff00]' : 'text-white/50'}`}
             >
               <Icon size={20} className="mb-1" />
               <span className="text-[8px] font-bold tracking-wider uppercase">{id}</span>
             </button>
          ))}
        </div>
      </div>
    </div>
  );
}

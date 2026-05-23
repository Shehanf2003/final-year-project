import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { X, Camera } from 'lucide-react';

const ScannerModal = ({ onClose, onScan }) => {
  const [cameras, setCameras] = useState([]);
  const [selectedCamera, setSelectedCamera] = useState('');
  const scannerRef = useRef(null);

  useEffect(() => {
    Html5Qrcode.getCameras().then((devices) => {
      if (devices && devices.length > 0) {
        setCameras(devices);
        // Default to a rear-facing camera if one exists, otherwise fallback to the first
        const backCamera = devices.find(d => d.label.toLowerCase().includes('back'));
        setSelectedCamera(backCamera ? backCamera.id : devices[0].id);
      }
    }).catch(err => console.error("Error getting cameras", err));
  }, []);

  useEffect(() => {
    if (!selectedCamera) return;

    let isProcessing = false;
    const scanner = new Html5Qrcode("reader");
    scannerRef.current = scanner;

    const playBeep = () => {
      try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioCtx.createOscillator();
        const gainNode = audioCtx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(800, audioCtx.currentTime); 
        gainNode.gain.setValueAtTime(0.1, audioCtx.currentTime); 
        oscillator.connect(gainNode);
        gainNode.connect(audioCtx.destination);

        oscillator.start();
        oscillator.stop(audioCtx.currentTime + 0.1); 
      } catch (error) {
        console.error("Audio playback failed:", error);
      }
    };

    const startScanning = async () => {
      try {
        await scanner.start(
          selectedCamera,
          {
            fps: 10,
            qrbox: { width: 250, height: 250 },
            aspectRatio: 1.0
          },
          (decodedText) => {
            if (!isProcessing) {
                isProcessing = true;
                playBeep();
                onScan(decodedText);
                onClose();
            }
          },
          (errorMessage) => {}
        );
      } catch (err) {
        console.error("Error starting scanner:", err);
      }
    };
    
    startScanning();

    return () => {
      if (scanner.isScanning) {
        scanner.stop().catch(error => console.error("Failed to stop scanner", error));
      }
    };
  }, [selectedCamera, onScan, onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-75">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-gray-700"
        >
          <X className="w-6 h-6" />
        </button>
        <h3 className="text-lg font-bold mb-4 text-center">Scan Barcode / QR Code</h3>
        
        {cameras.length > 0 && (
          <div className="mb-4 flex items-center gap-2">
            <Camera className="w-5 h-5 text-gray-500" />
            <select 
              value={selectedCamera} 
              onChange={(e) => setSelectedCamera(e.target.value)}
              className="flex-1 border-gray-300 rounded-md shadow-sm focus:ring-emerald-500 focus:border-emerald-500 p-2 border sm:text-sm"
            >
              {cameras.map(camera => (
                <option key={camera.id} value={camera.id}>
                  {camera.label || `Camera ${camera.id}`}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="relative w-full rounded overflow-hidden bg-black">
          <div id="reader" className="w-full"></div>
          
          {/* Scanning Laser Line Overlay */}
          <div className="absolute inset-0 pointer-events-none z-10">
            <div 
              className="absolute left-0 w-full h-0.5 bg-emerald-500 shadow-[0_0_15px_3px_rgba(16,185,129,0.8)]"
              style={{ animation: 'scan-line 2.5s ease-in-out infinite' }}
            ></div>
          </div>
        </div>
        <style>{`
          @keyframes scan-line {
            0%, 100% { top: 0%; opacity: 0; }
            10%, 90% { opacity: 1; }
            50% { top: 98%; }
          }
        `}</style>
        <p className="text-xs text-gray-500 text-center mt-2">
            Align the code within the frame.
        </p>
      </div>
    </div>
  );
};

export default ScannerModal;

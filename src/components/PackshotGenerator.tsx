import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Loader2, Download, RefreshCw, Layers, Camera, Image as ImageIcon, Sun, Palette, Zap, Target, SlidersHorizontal, Wand2, MessageSquare, Send } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { generatePackshot, homogenizePackshot, editPackshot } from '../lib/gemini';

interface ProcessedImage {
  name: string;
  base64: string;
  mimeType: string;
}

interface PackshotGeneratorProps {
  images: ProcessedImage[];
  onReset: () => void;
}

interface Adjustments {
  gammaBg: number;
  gammaObj: number;
  r: number;
  g: number;
  b: number;
  vibrance: number;
  sharpen: number;
}

const DEFAULT_ADJUSTMENTS: Adjustments = {
  gammaBg: 1,
  gammaObj: 1,
  r: 1,
  g: 1,
  b: 1,
  vibrance: 0,
  sharpen: 0
};

export const PackshotGenerator: React.FC<PackshotGeneratorProps> = ({ images, onReset }) => {
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationMethod, setGenerationMethod] = useState<'ai' | 'mathematical' | 'aligned-stack'>('ai');
  const [isHomogenizing, setIsHomogenizing] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [editPrompt, setEditPrompt] = useState('');
  const [homogenizeSettings, setHomogenizeSettings] = useState({ burnt: 15, dark: 15 });
  const [showHomogenizeOptions, setShowHomogenizeOptions] = useState(false);
  const [resultImage, setResultImage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustments>(DEFAULT_ADJUSTMENTS);
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const originalImageRef = useRef<HTMLImageElement | null>(null);

  // Reset state when source images change to prevent caching old results
  useEffect(() => {
    setResultImage(null);
    setError(null);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    originalImageRef.current = null;
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      ctx?.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
    }
  }, [images]);

  const rafRef = useRef<number | null>(null);

  const handleGenerate = async () => {
    if (generationMethod === 'ai') {
      setIsGenerating(true);
      setError(null);
      setAdjustments(DEFAULT_ADJUSTMENTS);
      try {
        const result = await generatePackshot(images);
        setResultImage(result);
        
        // Pre-load image for canvas processing
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = result;
        img.onload = () => {
          originalImageRef.current = img;
          applyAdjustments();
        };
      } catch (err: any) {
        console.error('Generation error:', err);
        if (err.message === 'API_KEY_ERROR') {
          setError('API Key error. Please refresh and select a valid key.');
        } else {
          setError('Failed to generate packshot. Please try again.');
        }
      } finally {
        setIsGenerating(false);
      }
    } else if (generationMethod === 'mathematical') {
      await handleMathematicalStacking();
    } else {
      await handleAlignedStacking();
    }
  };

  const handleMathematicalStacking = async () => {
    setIsGenerating(true);
    setError(null);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    try {
      // 1. Load all images into Image objects
      const loadedImages = await Promise.all(images.map(img => {
        return new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = `data:${img.mimeType};base64,${img.base64}`;
        });
      }));

      if (loadedImages.length === 0) return;

      const width = loadedImages[0].width;
      const height = loadedImages[0].height;

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error("Could not get canvas context");

      // 2. Get ImageData for all images
      const allImageData = loadedImages.map(img => {
        ctx.drawImage(img, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height);
      });

      // 3. Compute focus measure (Laplacian variance)
      const focusMaps = allImageData.map(() => new Float32Array(width * height));

      allImageData.forEach((id, imgIdx) => {
        const data = id.data;
        const focusMap = focusMaps[imgIdx];
        const lumMap = new Float32Array(width * height);
        
        // Pre-calculate luminance
        for (let i = 0; i < width * height; i++) {
          const idx = i * 4;
          lumMap[i] = (data[idx] * 0.299 + data[idx+1] * 0.587 + data[idx+2] * 0.114);
        }

        // Laplacian kernel
        for (let y = 1; y < height - 1; y++) {
          for (let x = 1; x < width - 1; x++) {
            const idx = y * width + x;
            const laplacian = Math.abs(
              4 * lumMap[idx] - lumMap[idx - 1] - lumMap[idx + 1] - lumMap[idx - width] - lumMap[idx + width]
            );
            focusMap[idx] = laplacian;
          }
        }
        
        // Smooth focus map with a box blur to reduce noise and artifacts
        const smoothedFocusMap = new Float32Array(width * height);
        const radius = 3;
        for (let y = radius; y < height - radius; y++) {
          for (let x = radius; x < width - radius; x++) {
            let sum = 0;
            for (let ky = -radius; ky <= radius; ky++) {
              for (let kx = -radius; kx <= radius; kx++) {
                sum += focusMap[(y + ky) * width + (x + kx)];
              }
            }
            smoothedFocusMap[y * width + x] = sum;
          }
        }
        focusMaps[imgIdx] = smoothedFocusMap;
      });

      // 4. Select best pixel from all images
      const resultData = ctx.createImageData(width, height);
      for (let i = 0; i < width * height; i++) {
        let bestImgIdx = 0;
        let maxFocus = -1;
        for (let imgIdx = 0; imgIdx < allImageData.length; imgIdx++) {
          if (focusMaps[imgIdx][i] > maxFocus) {
            maxFocus = focusMaps[imgIdx][i];
            bestImgIdx = imgIdx;
          }
        }

        const pixelIdx = i * 4;
        resultData.data[pixelIdx] = allImageData[bestImgIdx].data[pixelIdx];
        resultData.data[pixelIdx + 1] = allImageData[bestImgIdx].data[pixelIdx + 1];
        resultData.data[pixelIdx + 2] = allImageData[bestImgIdx].data[pixelIdx + 2];
        resultData.data[pixelIdx + 3] = 255;
      }

      ctx.putImageData(resultData, 0, 0);
      const result = canvas.toDataURL('image/png');
      setResultImage(result);
      
      const img = new Image();
      img.src = result;
      img.onload = () => {
        originalImageRef.current = img;
        applyAdjustments();
      };
    } catch (err) {
      console.error('Mathematical stacking error:', err);
      setError('Failed to process focus stacking. Ensure images are the same size.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleAlignedStacking = async () => {
    setIsGenerating(true);
    setError(null);
    setAdjustments(DEFAULT_ADJUSTMENTS);
    try {
      const response = await fetch('/api/focus-stack', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          images: images.map(img => ({
            name: img.name,
            base64: img.base64,
            mimeType: img.mimeType,
          })),
          options: { detector: 'AKAZE', blendTransitions: true },
        }),
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Focus stacking failed');
      }

      const data = await response.json();
      const resultDataUrl = `data:${data.result.mimeType};base64,${data.result.base64}`;
      setResultImage(resultDataUrl);

      // Log diagnostics
      console.log('[aligned-stack] Diagnostics:', data.diagnostics);

      const img = new Image();
      img.src = resultDataUrl;
      img.onload = () => {
        originalImageRef.current = img;
        applyAdjustments();
      };
    } catch (err: any) {
      console.error('Aligned stacking error:', err);
      setError(err.message || 'Failed to perform aligned focus stacking.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleHomogenize = async () => {
    if (!resultImage) return;
    setIsHomogenizing(true);
    setError(null);
    setShowHomogenizeOptions(false);
    try {
      const result = await homogenizePackshot(resultImage, images, homogenizeSettings.burnt, homogenizeSettings.dark);
      setResultImage(result);
      
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = result;
      img.onload = () => {
        originalImageRef.current = img;
        applyAdjustments();
      };
    } catch (err: any) {
      console.error('Homogenization error:', err);
      setError('Failed to homogenize lighting. Please try again.');
    } finally {
      setIsHomogenizing(false);
    }
  };

  const handleEdit = async () => {
    if (!resultImage || !editPrompt.trim()) return;
    setIsEditing(true);
    setError(null);
    try {
      const result = await editPackshot(resultImage, images, editPrompt);
      setResultImage(result);
      setEditPrompt('');
      
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = result;
      img.onload = () => {
        originalImageRef.current = img;
        applyAdjustments();
      };
    } catch (err: any) {
      console.error('Edit error:', err);
      setError('Failed to apply edits. Please try again.');
    } finally {
      setIsEditing(false);
    }
  };

  const applyAdjustments = () => {
    const canvas = canvasRef.current;
    const img = originalImageRef.current;
    if (!canvas || !img) return;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    const { gammaBg, gammaObj, r, g, b, vibrance, sharpen } = adjustments;

    // 1. Color and Gamma Pass
    for (let i = 0; i < data.length; i += 4) {
      let red = data[i];
      let green = data[i + 1];
      let blue = data[i + 2];

      // Background/Object separation (simple threshold)
      const brightness = (red + green + blue) / 3;
      const isBg = brightness > 240;
      const gamma = isBg ? gammaBg : gammaObj;

      // Apply Gamma
      if (gamma !== 1) {
        red = 255 * Math.pow(red / 255, 1 / gamma);
        green = 255 * Math.pow(green / 255, 1 / gamma);
        blue = 255 * Math.pow(blue / 255, 1 / gamma);
      }

      // Apply RGB (Object Only)
      if (!isBg) {
        red *= r;
        green *= g;
        blue *= b;
      }

      // Apply Vibrance (simplified)
      if (vibrance !== 0) {
        const avg = (red + green + blue) / 3;
        const max = Math.max(red, green, blue);
        const amt = (Math.abs(max - avg) / 255) * vibrance;
        red += (red - avg) * amt;
        green += (green - avg) * amt;
        blue += (blue - avg) * amt;
      }

      const finalR = Math.min(255, Math.max(0, red));
      const finalG = Math.min(255, Math.max(0, green));
      const finalB = Math.min(255, Math.max(0, blue));

      data[i] = finalR;
      data[i + 1] = finalG;
      data[i + 2] = finalB;
    }

    // 2. Sharpen Pass (Convolution)
    let processedData = data;
    if (sharpen > 0) {
      const weights = [
        0, -sharpen, 0,
        -sharpen, 1 + 4 * sharpen, -sharpen,
        0, -sharpen, 0
      ];
      const side = 3;
      const halfSide = 1;
      const sw = canvas.width;
      const sh = canvas.height;
      const output = new Uint8ClampedArray(data.length);

      for (let y = 0; y < sh; y++) {
        for (let x = 0; x < sw; x++) {
          const dstOff = (y * sw + x) * 4;
          let r_acc = 0, g_acc = 0, b_acc = 0;
          for (let cy = 0; cy < side; cy++) {
            for (let cx = 0; cx < side; cx++) {
              const scy = y + cy - halfSide;
              const scx = x + cx - halfSide;
              if (scy >= 0 && scy < sh && scx >= 0 && scx < sw) {
                const srcOff = (scy * sw + scx) * 4;
                const wt = weights[cy * side + cx];
                r_acc += data[srcOff] * wt;
                g_acc += data[srcOff + 1] * wt;
                b_acc += data[srcOff + 2] * wt;
              }
            }
          }
          output[dstOff] = Math.min(255, Math.max(0, r_acc));
          output[dstOff + 1] = Math.min(255, Math.max(0, g_acc));
          output[dstOff + 2] = Math.min(255, Math.max(0, b_acc));
          output[dstOff + 3] = data[dstOff + 3];
        }
      }
      processedData = output;
    }

    // 3. Final Composition
    ctx.putImageData(new ImageData(processedData, canvas.width, canvas.height), 0, 0);
  };

  useEffect(() => {
    if (resultImage && originalImageRef.current) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        applyAdjustments();
      });
    }
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [adjustments, resultImage]);

  const downloadResult = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    
    setIsDownloading(true);
    try {
      const imageBase64 = canvas.toDataURL('image/png');
      
      const response = await fetch('/api/convert-to-tiff', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ imageBase64 }),
      });

      if (!response.ok) {
        throw new Error('Failed to convert to TIFF');
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `packshot-${Date.now()}.tiff`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Download error:', err);
      setError('Failed to download TIFF. Please try again.');
    } finally {
      setIsDownloading(false);
    }
  };

  const updateAdj = (key: keyof Adjustments, val: number) => {
    setAdjustments(prev => ({ ...prev, [key]: val }));
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-12">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Source Images Panel */}
        <div className="lg:col-span-4 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                <Layers className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white uppercase tracking-tight">Source Data</h3>
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">{images.length} Processed RAW Frames</p>
              </div>
            </div>
            <button 
              onClick={onReset}
              className="p-2 hover:bg-white/5 rounded-lg text-gray-500 hover:text-white transition-all"
            >
              <RefreshCw className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            {images.map((img, idx) => (
              <motion.div 
                key={idx}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: idx * 0.1 }}
                className="aspect-square rounded-xl overflow-hidden border border-white/10 bg-[#151619] group relative"
              >
                <img 
                  src={`data:${img.mimeType};base64,${img.base64}`} 
                  alt={img.name} 
                  className="w-full h-full object-cover opacity-60 group-hover:opacity-100 transition-opacity"
                  referrerPolicy="no-referrer"
                />
              </motion.div>
            ))}
          </div>

          {!resultImage && (
            <div className="space-y-4 pt-4">
              <div className="flex bg-white/5 p-1 rounded-xl border border-white/10">
                <button
                  onClick={() => setGenerationMethod('ai')}
                  className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg transition-all ${generationMethod === 'ai' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-500 hover:text-white'}`}
                >
                  <Sparkles className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">AI Synthesis</span>
                </button>
                <button
                  onClick={() => setGenerationMethod('aligned-stack')}
                  className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg transition-all ${generationMethod === 'aligned-stack' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-500 hover:text-white'}`}
                >
                  <Target className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Aligned Stack</span>
                </button>
                <button
                  onClick={() => setGenerationMethod('mathematical')}
                  className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-lg transition-all ${generationMethod === 'mathematical' ? 'bg-orange-500 text-white shadow-lg shadow-orange-500/20' : 'text-gray-500 hover:text-white'}`}
                >
                  <Layers className="w-4 h-4" />
                  <span className="text-[10px] font-bold uppercase tracking-widest">Quick Stack</span>
                </button>
              </div>

              <button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-6 rounded-2xl transition-all active:scale-95 flex items-center justify-center space-x-4 shadow-2xl shadow-orange-500/20 uppercase tracking-[0.2em] text-sm"
              >
                {isGenerating ? (
                  <>
                    <Loader2 className="w-6 h-6 animate-spin" />
                    <span>{generationMethod === 'ai' ? 'Synthesizing...' : generationMethod === 'aligned-stack' ? 'Aligning & Stacking...' : 'Stacking...'}</span>
                  </>
                ) : (
                  <>
                    {generationMethod === 'ai' ? <Sparkles className="w-6 h-6" /> : generationMethod === 'aligned-stack' ? <Target className="w-6 h-6" /> : <Layers className="w-6 h-6" />}
                    <span>{generationMethod === 'ai' ? 'Generate Studio Packshot' : generationMethod === 'aligned-stack' ? 'Run Aligned Focus Stack' : 'Run Quick Stacking'}</span>
                  </>
                )}
              </button>
              
              <p className="text-[9px] text-gray-500 font-mono uppercase tracking-[0.15em] text-center px-4 leading-relaxed">
                {generationMethod === 'ai'
                  ? 'Uses Gemini 3.1 Flash to synthesize a perfect studio packshot with pure white background.'
                  : generationMethod === 'aligned-stack'
                  ? 'Server-side OpenCV alignment + multi-scale focus stacking. Corrects camera vibration, no LLM involved.'
                  : 'Client-side quick stacking: Combines sharpest parts without alignment. Fast but may show ghosting.'}
              </p>
            </div>
          )}
        </div>

        {/* Result Panel */}
        <div className="lg:col-span-8 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-white/5 rounded-xl flex items-center justify-center border border-white/10">
                <Camera className="w-5 h-5 text-orange-500" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-white uppercase tracking-tight">Final Output</h3>
                <p className="text-[10px] text-gray-500 font-mono uppercase tracking-widest">
                  {generationMethod === 'ai' ? 'AI Generated Studio Quality' : generationMethod === 'aligned-stack' ? 'Aligned Focus Stack (OpenCV)' : 'Quick Focus Stack'}
                </p>
              </div>
            </div>
            {resultImage && (
              <div className="flex items-center space-x-3 relative">
                <div className="relative">
                  <button 
                    onClick={() => setShowHomogenizeOptions(!showHomogenizeOptions)}
                    disabled={isHomogenizing}
                    className={`flex items-center space-x-2 px-4 py-2 ${showHomogenizeOptions ? 'bg-white/20' : 'bg-white/5'} hover:bg-white/10 text-white border border-white/10 rounded-xl transition-all font-bold text-xs uppercase tracking-widest disabled:opacity-50`}
                  >
                    {isHomogenizing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wand2 className="w-4 h-4 text-orange-500" />
                    )}
                    <span>Homogenize</span>
                  </button>

                  <AnimatePresence>
                    {showHomogenizeOptions && (
                      <motion.div 
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full right-0 mt-2 w-64 bg-[#1a1b1e] border border-white/10 rounded-2xl p-6 shadow-2xl z-50 space-y-6"
                      >
                        <div className="space-y-4">
                          <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-400">
                            <span>Burnt Reduction</span>
                            <span className="text-orange-500">{homogenizeSettings.burnt}%</span>
                          </div>
                          <input 
                            type="range"
                            min={0}
                            max={50}
                            step={1}
                            value={homogenizeSettings.burnt}
                            onChange={(e) => setHomogenizeSettings(prev => ({ ...prev, burnt: parseInt(e.target.value) }))}
                            className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-orange-500"
                          />
                        </div>

                        <div className="space-y-4">
                          <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-400">
                            <span>Dark Increase</span>
                            <span className="text-orange-500">{homogenizeSettings.dark}%</span>
                          </div>
                          <input 
                            type="range"
                            min={0}
                            max={50}
                            step={1}
                            value={homogenizeSettings.dark}
                            onChange={(e) => setHomogenizeSettings(prev => ({ ...prev, dark: parseInt(e.target.value) }))}
                            className="w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer accent-orange-500"
                          />
                        </div>

                        <button 
                          onClick={handleHomogenize}
                          className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl font-bold text-[10px] uppercase tracking-[0.2em] transition-all"
                        >
                          Apply Homogenization
                        </button>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <button 
                  onClick={downloadResult}
                  disabled={isDownloading}
                  className="flex items-center space-x-2 px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all font-bold text-xs uppercase tracking-widest disabled:opacity-50"
                >
                  {isDownloading ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Download className="w-4 h-4" />
                  )}
                  <span>{isDownloading ? 'Converting...' : 'Download TIFF'}</span>
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-2 space-y-6">
              <div className="aspect-square rounded-2xl border-2 border-dashed border-white/10 bg-[#151619] flex items-center justify-center relative overflow-hidden shadow-2xl">
                <AnimatePresence mode="wait">
                  {isGenerating || isHomogenizing || isEditing ? (
                    <motion.div 
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="flex flex-col items-center space-y-6 p-12 text-center"
                    >
                      <div className="relative">
                        <div className="w-24 h-24 border-4 border-orange-500/20 border-t-orange-500 rounded-full animate-spin" />
                        <Sparkles className="w-8 h-8 text-orange-500 absolute inset-0 m-auto animate-pulse" />
                      </div>
                      <div className="space-y-2">
                        <p className="text-white font-medium">
                          {isHomogenizing ? 'Homogenizing Lighting' : isEditing ? 'Applying Targeted Edits' : generationMethod === 'ai' ? 'Technical Synthesis in Progress' : generationMethod === 'aligned-stack' ? 'Aligned Focus Stacking (OpenCV)' : 'Mathematical Focus Stacking'}
                        </p>
                        <p className="text-xs text-gray-500 max-w-[200px]">
                          {isHomogenizing 
                            ? 'Balancing overexposed highlights and underexposed shadows while maintaining product fidelity.'
                            : isEditing
                            ? 'Applying your specific modifications while preserving the core product identity.'
                            : generationMethod === 'ai'
                            ? 'Enforcing strict packshot standards: Pure white background, zero artistic deviation, and exact product fidelity.'
                            : generationMethod === 'aligned-stack'
                            ? 'Detecting features, aligning frames, computing multi-scale focus maps, and blending for a sharp, ghost-free result.'
                            : 'Analyzing local contrast and sharpness across all frames to reconstruct a single high-depth-of-field image.'}
                        </p>
                      </div>
                    </motion.div>
                  ) : resultImage ? (
                  <motion.div 
                    key="result"
                    initial={{ opacity: 0, scale: 1.1 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="w-full h-full p-4"
                  >
                    <canvas 
                      ref={canvasRef}
                      className="w-full h-full object-contain rounded-xl shadow-2xl"
                    />
                  </motion.div>
                ) : (
                  <div className="flex flex-col items-center space-y-4 text-gray-600">
                    <ImageIcon className="w-16 h-16 opacity-20" />
                    <p className="text-sm font-mono uppercase tracking-widest opacity-40">Awaiting Generation</p>
                  </div>
                )}
              </AnimatePresence>
            </div>

            {/* Prompt Edit Bar */}
            {resultImage && !isGenerating && !isHomogenizing && !isEditing && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="relative group"
              >
                <div className="absolute inset-0 bg-orange-500/5 blur-xl group-hover:bg-orange-500/10 transition-all rounded-2xl" />
                <div className="relative flex items-center bg-[#1a1b1e] border border-white/10 rounded-2xl p-2 pl-4 shadow-xl focus-within:border-orange-500/50 transition-all">
                  <MessageSquare className="w-4 h-4 text-gray-500 mr-3" />
                  <input 
                    type="text"
                    value={editPrompt}
                    onChange={(e) => setEditPrompt(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleEdit()}
                    placeholder="Describe a specific change (e.g., 'Change cap color to red', 'Remove the label')..."
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-white placeholder:text-gray-600 py-2"
                  />
                  <button 
                    onClick={handleEdit}
                    disabled={!editPrompt.trim() || isEditing}
                    className="p-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white rounded-xl transition-all ml-2"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
                <p className="mt-2 text-[9px] text-gray-500 font-mono uppercase tracking-widest text-center">
                  Targeted AI Editing • No additional creativity applied
                </p>
              </motion.div>
            )}
          </div>

            {/* Adjustments Panel */}
            {resultImage && (
              <div className="space-y-6 bg-white/[0.02] border border-white/5 rounded-2xl p-6">
                <div className="flex items-center space-x-2 text-white mb-4">
                  <SlidersHorizontal className="w-4 h-4 text-orange-500" />
                  <h4 className="text-xs font-bold uppercase tracking-widest">Image Adjustments</h4>
                </div>

                <div className="space-y-6">
                  {/* Gamma Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-500">
                      <div className="flex items-center space-x-2">
                        <Sun className="w-3 h-3" />
                        <span>Gamma</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <AdjustmentSlider label="Background" value={adjustments.gammaBg} min={0.5} max={2} step={0.01} onChange={v => updateAdj('gammaBg', v)} />
                      <AdjustmentSlider label="Object" value={adjustments.gammaObj} min={0.5} max={2} step={0.01} onChange={v => updateAdj('gammaObj', v)} />
                    </div>
                  </div>

                  {/* RGB Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-500">
                      <div className="flex items-center space-x-2">
                        <Palette className="w-3 h-3" />
                        <span>RGB Balance</span>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <AdjustmentSlider label="Red" value={adjustments.r} min={0.5} max={1.5} step={0.01} color="accent-red-500" onChange={v => updateAdj('r', v)} />
                      <AdjustmentSlider label="Green" value={adjustments.g} min={0.5} max={1.5} step={0.01} color="accent-green-500" onChange={v => updateAdj('g', v)} />
                      <AdjustmentSlider label="Blue" value={adjustments.b} min={0.5} max={1.5} step={0.01} color="accent-blue-500" onChange={v => updateAdj('b', v)} />
                    </div>
                  </div>

                  {/* Effects Section */}
                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-500">
                      <div className="flex items-center space-x-2">
                        <Zap className="w-3 h-3" />
                        <span>Vibrance</span>
                      </div>
                    </div>
                    <AdjustmentSlider label="Intensity" value={adjustments.vibrance} min={-1} max={1} step={0.01} onChange={v => updateAdj('vibrance', v)} />
                  </div>

                  <div className="space-y-4">
                    <div className="flex items-center justify-between text-[10px] font-mono uppercase text-gray-500">
                      <div className="flex items-center space-x-2">
                        <Target className="w-3 h-3" />
                        <span>Sharpen</span>
                      </div>
                    </div>
                    <AdjustmentSlider label="Detail" value={adjustments.sharpen} min={0} max={1} step={0.01} onChange={v => updateAdj('sharpen', v)} />
                  </div>
                </div>

                <button 
                  onClick={() => setAdjustments(DEFAULT_ADJUSTMENTS)}
                  className="w-full mt-6 py-2 text-[10px] font-mono uppercase tracking-widest text-gray-500 hover:text-white transition-colors border border-white/5 hover:border-white/10 rounded-lg"
                >
                  Reset Adjustments
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm flex items-center space-x-3">
              <div className="w-2 h-2 bg-red-500 rounded-full animate-pulse" />
              <span>{error}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  color?: string;
  onChange: (val: number) => void;
}

const AdjustmentSlider: React.FC<SliderProps> = ({ label, value, min, max, step, color = "accent-orange-500", onChange }) => {
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[9px] font-mono text-gray-400">
        <span>{label}</span>
        <span>{value.toFixed(2)}</span>
      </div>
      <input 
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full h-1 bg-white/5 rounded-lg appearance-none cursor-pointer ${color}`}
      />
    </div>
  );
};

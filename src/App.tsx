import React, { useState, useEffect } from 'react';
import { Camera, Layers, Sparkles, Info, Github, ExternalLink, Cpu } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ApiKeySelector } from './components/ApiKeySelector';
import { RawUploader } from './components/RawUploader';
import { PackshotGenerator } from './components/PackshotGenerator';

export default function App() {
  const [isKeySelected, setIsKeySelected] = useState(false);
  const [processedImages, setProcessedImages] = useState<{ name: string, base64: string, mimeType: string }[]>([]);
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>('checking');

  const checkApi = async () => {
    setApiStatus('checking');
    try {
      const res = await fetch('/api/ping');
      const text = await res.text();
      if (text.startsWith('<!DOCTYPE html>')) {
        setApiStatus('error');
      } else {
        setApiStatus('ok');
      }
    } catch (e) {
      setApiStatus('error');
    }
  };

  useEffect(() => {
    checkApi();
  }, []);

  return (
    <div className="min-h-screen bg-[#0a0b0d] text-gray-300 font-sans selection:bg-orange-500/30 selection:text-orange-200">
      <ApiKeySelector onKeySelected={() => setIsKeySelected(true)} />

      {/* Background Atmosphere */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center space-x-4">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20">
              <Camera className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-white uppercase tracking-tighter leading-none">RAW Packshot</h1>
              <span className="text-[10px] text-orange-500 font-mono uppercase tracking-[0.3em] mt-1">Studio Synthesizer v1.0</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center space-x-8">
            <button 
              onClick={checkApi}
              className="text-xs font-mono uppercase tracking-widest text-gray-500 hover:text-white transition-colors"
            >
              Check API Status
            </button>
            <button
              onClick={() => {
                delete (window as any).__GEMINI_API_KEY__;
                setIsKeySelected(false);
              }}
              className="text-xs font-mono uppercase tracking-widest text-orange-500 hover:text-orange-400 transition-colors"
            >
              Reset API Key
            </button>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex items-center space-x-2 px-3 py-1.5 bg-white/5 border border-white/10 rounded-full">
              <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${
                apiStatus === 'ok' ? 'bg-green-500' : 
                apiStatus === 'error' ? 'bg-red-500' : 'bg-yellow-500'
              }`} />
              <span className="text-[10px] font-mono uppercase tracking-widest text-gray-400">
                {apiStatus === 'ok' ? 'System Ready' : 
                 apiStatus === 'error' ? 'API Error' : 'Connecting...'}
              </span>
            </div>
          </nav>
        </div>
      </header>

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-12 space-y-24">
        {/* Hero Section */}
        <section className="text-center space-y-6 max-w-3xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-full text-orange-400 text-[10px] font-mono uppercase tracking-[0.2em]"
          >
            <Cpu className="w-3 h-3" />
            <span>Powered by Gemini 3.1 Flash Image</span>
          </motion.div>
          
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-5xl md:text-7xl font-bold text-white uppercase tracking-tighter leading-[0.9]"
          >
            From RAW to <span className="text-orange-500">Studio</span> in Seconds.
          </motion.h2>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="text-gray-500 text-lg max-w-2xl mx-auto leading-relaxed"
          >
            Upload your camera RAW files and create professional,
            high-fidelity product packshots with perfect studio lighting.
          </motion.p>
        </section>

        {/* Main Interaction Area */}
        <section className="relative">
          <AnimatePresence mode="wait">
            {processedImages.length === 0 ? (
              <motion.div 
                key="uploader"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 1.05 }}
              >
                <RawUploader onImagesProcessed={setProcessedImages} />
              </motion.div>
            ) : (
              <motion.div 
                key="generator"
                initial={{ opacity: 0, scale: 1.05 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                <PackshotGenerator 
                  images={processedImages} 
                  onReset={() => setProcessedImages([])} 
                />
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {/* Features Grid */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {[
            {
              icon: <Layers className="w-6 h-6" />,
              title: "RAW Processing",
              desc: "Deep analysis of RAW data to extract high-fidelity previews. Supports 1181+ cameras."
            },
            {
              icon: <Sparkles className="w-6 h-6" />,
              title: "AI Synthesis",
              desc: "Gemini 3.1 Flash Image generates studio-quality lighting and clean backgrounds."
            },
            {
              icon: <Info className="w-6 h-6" />,
              title: "Batch Support",
              desc: "Upload multiple angles to help the AI understand the product's geometry."
            }
          ].map((feature, idx) => (
            <motion.div 
              key={idx}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: idx * 0.1 }}
              className="p-8 bg-white/[0.02] border border-white/5 rounded-3xl space-y-4 hover:bg-white/[0.04] transition-all group"
            >
              <div className="w-12 h-12 bg-white/5 rounded-2xl flex items-center justify-center text-orange-500 group-hover:scale-110 transition-transform">
                {feature.icon}
              </div>
              <h4 className="text-lg font-bold text-white uppercase tracking-tight">{feature.title}</h4>
              <p className="text-sm text-gray-500 leading-relaxed">{feature.desc}</p>
            </motion.div>
          ))}
        </section>
      </main>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 bg-black/40 backdrop-blur-xl mt-24">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between space-y-6 md:space-y-0">
          <div className="flex items-center space-x-2 text-gray-600 text-[10px] font-mono uppercase tracking-widest">
            <span>© 2026 RAW Packshot Synthesizer</span>
            <span className="px-2">•</span>
            <span>Built for Professional Product Photography</span>
          </div>
          
          <div className="flex items-center space-x-6">
            <a href="#" className="text-gray-600 hover:text-white transition-colors">
              <Github className="w-5 h-5" />
            </a>
            <a href="#" className="text-gray-600 hover:text-white transition-colors">
              <ExternalLink className="w-5 h-5" />
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/**
 * RAW file upload component — drag-drop or file picker, sends each file
 * to /api/process-raw with retry logic and exponential backoff.
 */

import React, { useState, useRef } from 'react';
import { Upload, FileCode, X, CheckCircle2, Loader2 } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface ProcessedImage {
  name: string;
  base64: string;
  mimeType: string;
  error?: string;
}

interface RawUploaderProps {
  onImagesProcessed: (images: ProcessedImage[]) => void;
}

export const RawUploader: React.FC<RawUploaderProps> = ({ onImagesProcessed }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const rawExtensions = ['.cr2','.cr3','.nef','.nrw','.arw','.srf','.sr2','.dng','.raf','.orf','.rw2','.rwl','.pef','.ptx','.srw','.x3f','.3fr','.fff','.iiq','.mrw','.mef','.mos','.kdc','.dcr','.raw','.rwz','.erf','.bay','.psd','.psb'];
      const newFiles = (Array.from(e.target.files) as File[]).filter(f => rawExtensions.some(ext => f.name.toLowerCase().endsWith(ext)));
      setFiles(prev => [...prev, ...newFiles]);
    }
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    const allProcessedImages: ProcessedImage[] = [];

    try {
      // 1. Pre-flight ping to clear any "Cookie check" challenges
      try {
        await fetch('/api/ping', { credentials: 'include' });
        console.log('Pre-flight ping successful');
      } catch (e) {
        console.warn('Pre-flight ping failed, continuing anyway:', e);
      }

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        
        // Add a small delay between files to avoid triggering proxy rate limits/challenges
        if (i > 0) {
          await new Promise(resolve => setTimeout(resolve, 800));
        }

        const formData = new FormData();
        formData.append('images', file);

        let response;
        let text = '';
        let retryCount = 0;
        const maxRetries = 3; // Increased retries

        while (retryCount <= maxRetries) {
          response = await fetch('/api/process-raw', {
            method: 'POST',
            body: formData,
            credentials: 'include',
            headers: {
              'Accept': 'application/json',
              'X-Requested-With': 'XMLHttpRequest'
            }
          });

          text = await response.text();
          
          // Check if we got a "Cookie check" or any HTML response instead of JSON
          const isHtml = text.trim().toLowerCase().startsWith('<!doctype html') || text.includes('<html') || text.includes('<title>Cookie check</title>');
          
          if (response.status === 200 && isHtml && retryCount < maxRetries) {
            console.warn(`HTML/Cookie check detected for ${file.name}, retrying... (${retryCount + 1}/${maxRetries})`);
            retryCount++;
            // Exponential backoff
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            continue;
          }
          break;
        }

        if (!response) throw new Error(`Failed to get response for ${file.name}`);

        if (response.status === 413) {
          throw new Error(`File ${file.name} is too large for the server. The current limit is likely around 25-50MB.`);
        }

        console.log(`Raw response for ${file.name} (first 200 chars):`, text.substring(0, 200));
        
        let data;
        try {
          data = JSON.parse(text);
        } catch (e) {
          console.error(`Failed to parse response for ${file.name}. Status: ${response.status}. Body length: ${text.length}. Preview:`, text.substring(0, 500));
          if (response.status >= 500) {
            throw new Error(`Server Error (${response.status}) while processing ${file.name}. The server might have crashed or run out of memory.`);
          }
          throw new Error(`Server returned invalid response for ${file.name}. Status: ${response.status}. Body starts with: ${text.substring(0, 50) || '(empty)'}`);
        }

        if (!response.ok) {
          throw new Error(data.error || `Failed to process ${file.name}`);
        }

        if (data.images && data.images.length > 0) {
          allProcessedImages.push(...data.images.filter((img: ProcessedImage) => !img.error));
        }
      }

      onImagesProcessed(allProcessedImages);
      setFiles([]); // Clear queue on success
    } catch (error: any) {
      console.error('Upload error:', error);
      alert(`Upload error: ${error.message}`);
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <div 
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          const rawExtensions = ['.cr2','.cr3','.nef','.nrw','.arw','.srf','.sr2','.dng','.raf','.orf','.rw2','.rwl','.pef','.ptx','.srw','.x3f','.3fr','.fff','.iiq','.mrw','.mef','.mos','.kdc','.dcr','.raw','.rwz','.erf','.bay','.psd','.psb'];
          const droppedFiles = (Array.from(e.dataTransfer.files) as File[]).filter(f => rawExtensions.some(ext => f.name.toLowerCase().endsWith(ext)));
          setFiles(prev => [...prev, ...droppedFiles]);
        }}
        className="group relative border-2 border-dashed border-white/10 hover:border-orange-500/50 rounded-2xl p-12 transition-all cursor-pointer bg-white/[0.02] hover:bg-white/[0.04] overflow-hidden"
      >
        <div className="absolute inset-0 bg-radial-gradient from-orange-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        
        <div className="relative flex flex-col items-center space-y-4 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
            <Upload className="w-8 h-8 text-gray-400 group-hover:text-orange-500" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-medium text-white">Upload RAW Files</h3>
            <p className="text-sm text-gray-500">Drag and drop or click to select camera RAW or PSD files</p>
          </div>
          <input 
            type="file" 
            ref={fileInputRef} 
            onChange={handleFileChange} 
            multiple 
            accept=".cr2,.cr3,.nef,.nrw,.arw,.srf,.sr2,.dng,.raf,.orf,.rw2,.rwl,.pef,.ptx,.srw,.x3f,.3fr,.fff,.iiq,.mrw,.mef,.mos,.kdc,.dcr,.raw,.rwz,.erf,.bay,.psd,.psb" 
            className="hidden" 
          />
        </div>
      </div>

      <AnimatePresence>
        {files.length > 0 && (
          <motion.div 
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="bg-[#151619] border border-white/10 rounded-2xl overflow-hidden shadow-2xl"
          >
            <div className="p-4 border-bottom border-white/5 bg-white/5 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <FileCode className="w-4 h-4 text-orange-500" />
                <span className="text-xs font-mono uppercase tracking-widest text-gray-400">Queue: {files.length} Files</span>
              </div>
              <button 
                onClick={() => setFiles([])}
                className="text-xs text-gray-500 hover:text-white uppercase tracking-widest transition-colors"
              >
                Clear All
              </button>
            </div>
            
            <div className="max-h-60 overflow-y-auto p-2 space-y-1 custom-scrollbar">
              {files.map((file, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 rounded-lg hover:bg-white/5 transition-colors group">
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 bg-white/5 rounded flex items-center justify-center">
                      <FileCode className="w-4 h-4 text-gray-500" />
                    </div>
                    <div className="flex flex-col">
                      <span className="text-sm text-gray-300 truncate max-w-[200px]">{file.name}</span>
                      <span className="text-[10px] text-gray-600 font-mono uppercase">{(file.size / (1024 * 1024)).toFixed(2)} MB</span>
                    </div>
                  </div>
                  <button 
                    onClick={() => removeFile(idx)}
                    className="p-1.5 hover:bg-red-500/10 hover:text-red-500 text-gray-600 rounded-md transition-all opacity-0 group-hover:opacity-100"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="p-4 bg-white/[0.02]">
              <button
                onClick={handleUpload}
                disabled={isUploading}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-4 rounded-xl transition-all active:scale-95 flex items-center justify-center space-x-3 shadow-lg shadow-orange-500/10 uppercase tracking-widest text-sm"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Processing RAW Data...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-5 h-5" />
                    <span>Process {files.length} Files</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

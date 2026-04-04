/**
 * RAW file upload component — drag-drop or file picker, sends each file
 * to /api/process-raw with retry logic and exponential backoff.
 */

import React, { useState, useRef } from 'react';
import { Upload, FileCode, X, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
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

const RAW_EXTENSIONS = ['.cr2','.cr3','.nef','.nrw','.arw','.srf','.sr2','.dng','.raf','.orf','.rw2','.rwl','.pef','.ptx','.srw','.x3f','.3fr','.fff','.iiq','.mrw','.mef','.mos','.kdc','.dcr','.raw','.rwz','.erf','.bay','.psd','.psb'];
const MAX_FILE_SIZE_MB = 100;

/** Check if file has a supported RAW/PSD extension. */
const isSupported = (name: string) => RAW_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));

export const RawUploader: React.FC<RawUploaderProps> = ({ onImagesProcessed }) => {
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  /** Filter and add files, showing feedback for skipped/oversized ones. */
  const addFiles = (incoming: File[]) => {
    const accepted: File[] = [];
    const skippedType: string[] = [];
    const skippedSize: string[] = [];

    for (const f of incoming) {
      if (!isSupported(f.name)) {
        skippedType.push(f.name);
      } else if (f.size > MAX_FILE_SIZE_MB * 1024 * 1024) {
        skippedSize.push(`${f.name} (${(f.size / (1024 * 1024)).toFixed(0)}MB)`);
      } else {
        accepted.push(f);
      }
    }

    if (accepted.length > 0) {
      setFiles(prev => [...prev, ...accepted]);
    }

    const warnings: string[] = [];
    if (skippedType.length > 0) {
      warnings.push(`${skippedType.length} file${skippedType.length > 1 ? 's' : ''} skipped (unsupported format)`);
    }
    if (skippedSize.length > 0) {
      warnings.push(`${skippedSize.length} file${skippedSize.length > 1 ? 's' : ''} skipped (over ${MAX_FILE_SIZE_MB}MB)`);
    }
    setWarning(warnings.length > 0 ? warnings.join('. ') : null);

    // Auto-clear warning after 5s
    if (warnings.length > 0) setTimeout(() => setWarning(null), 5000);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) addFiles(Array.from(e.target.files));
  };

  const removeFile = (index: number) => {
    setFiles(prev => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) return;

    setIsUploading(true);
    setError(null);
    const allProcessedImages: ProcessedImage[] = [];

    try {
      // Pre-flight ping to clear proxy challenges
      try { await fetch('/api/ping', { credentials: 'include' }); } catch (_) {}

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setUploadProgress({ current: i + 1, total: files.length, fileName: file.name });

        if (i > 0) await new Promise(resolve => setTimeout(resolve, 800));

        const formData = new FormData();
        formData.append('images', file);

        let response;
        let text = '';
        let retryCount = 0;
        const maxRetries = 3;

        while (retryCount <= maxRetries) {
          response = await fetch('/api/process-raw', {
            method: 'POST',
            body: formData,
            credentials: 'include',
            headers: { 'Accept': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
          });

          text = await response.text();
          const isHtml = text.trim().toLowerCase().startsWith('<!doctype html') || text.includes('<html');

          if (response.status === 200 && isHtml && retryCount < maxRetries) {
            retryCount++;
            await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
            continue;
          }
          break;
        }

        if (!response) throw new Error(`Failed to get response for ${file.name}`);
        if (response.status === 413) throw new Error(`${file.name} exceeds server size limit`);

        let data;
        try {
          data = JSON.parse(text);
        } catch (_) {
          if (response.status >= 500) throw new Error(`Server error (${response.status}) processing ${file.name}`);
          throw new Error(`Invalid server response for ${file.name}`);
        }

        if (!response.ok) throw new Error(data.error || `Failed to process ${file.name}`);

        if (data.images?.length > 0) {
          allProcessedImages.push(...data.images.filter((img: ProcessedImage) => !img.error));
        }
      }

      onImagesProcessed(allProcessedImages);
      setFiles([]);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setIsUploading(false);
      setUploadProgress(null);
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto space-y-6">
      <div
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          addFiles(Array.from(e.dataTransfer.files));
        }}
        className="group relative border-2 border-dashed border-white/10 hover:border-orange-500/50 rounded-2xl p-12 transition-all cursor-pointer bg-white/[0.02] hover:bg-white/[0.04] overflow-hidden"
        role="button"
        aria-label="Upload RAW or PSD files"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
      >
        <div className="absolute inset-0 bg-radial-gradient from-orange-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />

        <div className="relative flex flex-col items-center space-y-4 text-center">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center group-hover:scale-110 transition-transform">
            <Upload className="w-8 h-8 text-gray-400 group-hover:text-orange-500" />
          </div>
          <div className="space-y-1">
            <h3 className="text-lg font-medium text-white">Upload RAW Files</h3>
            <p className="text-sm text-gray-500">Drag and drop or click to select camera RAW or PSD files</p>
            <p className="text-[10px] text-gray-600 font-mono uppercase tracking-widest">Max {MAX_FILE_SIZE_MB}MB per file • CR2, CR3, NEF, ARW, DNG, RAF, PSD...</p>
          </div>
          <input
            type="file"
            ref={fileInputRef}
            onChange={handleFileChange}
            multiple
            accept={RAW_EXTENSIONS.join(',')}
            className="hidden"
            aria-label="Select RAW files"
          />
        </div>
      </div>

      {/* Warning for skipped files */}
      <AnimatePresence>
        {warning && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center space-x-2 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-yellow-400 text-sm"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{warning}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error display */}
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex items-center space-x-2 px-4 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm"
          >
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
            <button onClick={() => setError(null)} className="ml-auto text-red-500 hover:text-red-300">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

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
                aria-label="Clear all files"
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
                    aria-label={`Remove ${file.name}`}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>

            <div className="p-4 bg-white/[0.02] space-y-3">
              {/* Per-file progress during upload */}
              {uploadProgress && (
                <div className="space-y-2">
                  <div className="flex justify-between text-[10px] font-mono uppercase text-gray-400">
                    <span>Processing {uploadProgress.fileName}</span>
                    <span>{uploadProgress.current}/{uploadProgress.total}</span>
                  </div>
                  <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-orange-500 rounded-full transition-all duration-500"
                      style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              <button
                onClick={handleUpload}
                disabled={isUploading}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-4 rounded-xl transition-all active:scale-95 flex items-center justify-center space-x-3 shadow-lg shadow-orange-500/10 uppercase tracking-widest text-sm"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="w-5 h-5 animate-spin" />
                    <span>Processing {uploadProgress?.current || 0}/{uploadProgress?.total || files.length}...</span>
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

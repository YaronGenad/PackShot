import React, { useState, useEffect } from 'react';
import { Key, AlertCircle, ExternalLink, SkipForward } from 'lucide-react';

interface ApiKeySelectorProps {
  onKeySelected: () => void;
}

export const ApiKeySelector: React.FC<ApiKeySelectorProps> = ({ onKeySelected }) => {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [manualKey, setManualKey] = useState('');
  const [showManualInput, setShowManualInput] = useState(false);

  useEffect(() => {
    // Check if server already has an API key configured
    fetch('/api/has-gemini-key').then(r => r.json())
      .then(data => {
        if (data.hasKey) { setHasKey(true); onKeySelected(); }
        else { setHasKey(false); }
      })
      .catch(() => setHasKey(false));
  }, [onKeySelected]);

  const handleSubmitKey = async () => {
    if (!manualKey.trim()) return;
    const res = await fetch('/api/set-gemini-key', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: manualKey.trim() }),
    });
    if (res.ok) { setHasKey(true); onKeySelected(); }
  };

  const handleSkip = () => {
    setHasKey(true);
    onKeySelected();
  };

  if (hasKey === true) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="api-key-title">
      <div className="bg-[#151619] border border-white/10 rounded-2xl max-w-md w-full p-8 shadow-2xl">
        <div className="flex flex-col items-center text-center space-y-6">
          <div className="w-16 h-16 bg-orange-500/10 rounded-full flex items-center justify-center">
            <Key className="w-8 h-8 text-orange-500" />
          </div>

          <div className="space-y-2">
            <h2 className="text-2xl font-bold text-white uppercase tracking-tight font-mono">
              <span id="api-key-title">API Key Setup</span>
            </h2>
            <p className="text-gray-400 text-sm leading-relaxed">
              Enter a Gemini API key for AI features, or skip to use deterministic focus stacking only.
            </p>
          </div>

          {showManualInput ? (
            <div className="w-full space-y-4">
              <input
                type="password"
                value={manualKey}
                onChange={(e) => setManualKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSubmitKey()}
                placeholder="Paste your Gemini API key..."
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-orange-500/50 transition-colors"
                aria-label="Gemini API key"
                autoFocus
              />
              <div className="flex space-x-3">
                <button
                  onClick={handleSubmitKey}
                  disabled={!manualKey.trim()}
                  className="flex-1 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-3 rounded-xl transition-all active:scale-95 uppercase tracking-widest text-xs"
                >
                  Save Key
                </button>
                <button
                  onClick={() => setShowManualInput(false)}
                  className="px-4 py-3 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl transition-all text-xs uppercase tracking-widest"
                >
                  Back
                </button>
              </div>
              <div className="bg-orange-500/5 border border-orange-500/20 rounded-xl p-3 flex items-start space-x-3 text-left">
                <AlertCircle className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                <p className="text-[11px] text-orange-200/80 leading-relaxed">
                  Key is stored in memory only (not saved to disk). Required for AI Synthesis and Homogenize features.
                  <a
                    href="https://ai.google.dev/gemini-api/docs/billing"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center ml-1 text-orange-400 hover:text-orange-300 underline decoration-orange-400/30 underline-offset-2"
                  >
                    Billing Docs <ExternalLink className="w-3 h-3 ml-0.5" />
                  </a>
                </p>
              </div>
            </div>
          ) : (
            <div className="w-full space-y-3">
              <button
                onClick={() => setShowManualInput(true)}
                className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-4 rounded-xl transition-all active:scale-95 shadow-lg shadow-orange-500/20 uppercase tracking-widest text-sm"
              >
                Enter API Key
              </button>
              <button
                onClick={handleSkip}
                className="w-full flex items-center justify-center space-x-2 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white font-bold py-4 rounded-xl transition-all active:scale-95 uppercase tracking-widest text-xs border border-white/5"
              >
                <SkipForward className="w-4 h-4" />
                <span>Skip — Use Focus Stacking Only</span>
              </button>
              <p className="text-[10px] text-gray-600 font-mono uppercase tracking-widest">
                AI features require a paid Gemini API key. Focus stacking works without one.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

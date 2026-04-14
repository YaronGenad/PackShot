/**
 * BYOK Settings — manage user's own AI provider API keys.
 * Shows connected providers and allows adding/removing keys.
 */

import React, { useState, useEffect } from 'react';
import { Key, Plus, Trash2, Check, AlertCircle, X } from 'lucide-react';
import { useAuth } from '../lib/auth-context';

const PROVIDERS = [
  { id: 'gemini', name: 'Google Gemini', placeholder: 'AIzaSy...' },
  { id: 'openai', name: 'OpenAI', placeholder: 'sk-...' },
  { id: 'grok', name: 'xAI Grok', placeholder: 'xai-...' },
  { id: 'flux', name: 'Flux', placeholder: 'flux-...' },
] as const;

interface BYOKSettingsProps {
  isOpen: boolean;
  onClose: () => void;
}

export const BYOKSettings: React.FC<BYOKSettingsProps> = ({ isOpen, onClose }) => {
  const { user, refreshCredits } = useAuth();
  const [connectedProviders, setConnectedProviders] = useState<string[]>([]);
  const [addingProvider, setAddingProvider] = useState<string | null>(null);
  const [newKey, setNewKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (isOpen && user) {
      fetchProviders();
    }
  }, [isOpen, user]);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/credits/ai-keys', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setConnectedProviders(data.providers.map((p: any) => p.provider));
      }
    } catch {
      // Silently fail
    }
  };

  const handleAddKey = async (provider: string) => {
    if (!newKey.trim() || newKey.length < 10) {
      setError('API key must be at least 10 characters');
      return;
    }
    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/credits/ai-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider, key: newKey.trim() }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to save key');
        return;
      }

      setNewKey('');
      setAddingProvider(null);
      await fetchProviders();
      refreshCredits();
    } catch {
      setError('Network error');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteKey = async (provider: string) => {
    setLoading(true);
    try {
      await fetch(`/api/credits/ai-key/${provider}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      await fetchProviders();
      refreshCredits();
    } catch {
      // Silently fail
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[60] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-[#151619] border border-white/10 rounded-2xl max-w-lg w-full p-8 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 bg-orange-500/10 rounded-xl flex items-center justify-center">
            <Key className="w-5 h-5 text-orange-500" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-white uppercase tracking-tight">AI Provider Keys</h3>
            <p className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
              Use your own API keys — no credits consumed
            </p>
          </div>
        </div>

        <div className="space-y-3">
          {PROVIDERS.map(provider => {
            const isConnected = connectedProviders.includes(provider.id);
            const isAdding = addingProvider === provider.id;

            return (
              <div key={provider.id} className="border border-white/5 rounded-xl overflow-hidden">
                <div className="flex items-center justify-between px-4 py-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-gray-600'}`} />
                    <span className="text-sm text-white font-medium">{provider.name}</span>
                  </div>
                  {isConnected ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[9px] font-mono uppercase tracking-widest text-green-400 flex items-center gap-1">
                        <Check className="w-3 h-3" /> Connected
                      </span>
                      <button
                        onClick={() => handleDeleteKey(provider.id)}
                        disabled={loading}
                        className="p-1.5 text-gray-500 hover:text-red-400 transition-colors"
                        title="Remove key"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setAddingProvider(isAdding ? null : provider.id);
                        setNewKey('');
                        setError('');
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-widest text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors"
                    >
                      <Plus className="w-3 h-3" />
                      Add Key
                    </button>
                  )}
                </div>

                {isAdding && (
                  <div className="px-4 pb-3 space-y-2">
                    <input
                      type="password"
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handleAddKey(provider.id)}
                      placeholder={provider.placeholder}
                      className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-orange-500/50 transition-colors"
                      autoFocus
                    />
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleAddKey(provider.id)}
                        disabled={loading || !newKey.trim()}
                        className="flex-1 px-3 py-2 bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white text-[10px] font-mono uppercase tracking-widest rounded-lg transition-colors"
                      >
                        {loading ? 'Saving...' : 'Save Key'}
                      </button>
                      <button
                        onClick={() => { setAddingProvider(null); setError(''); }}
                        className="px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-400 text-[10px] font-mono uppercase tracking-widest rounded-lg transition-colors"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {error && (
          <div className="flex items-center gap-2 mt-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <p className="text-[9px] text-gray-600 font-mono mt-4 leading-relaxed">
          Keys are encrypted at rest (AES-256) and never shared. When a key is set for a provider,
          AI operations use your key directly — no PackShot credits are consumed.
        </p>
      </div>
    </div>
  );
};

/**
 * Watermark preview — shows Free tier users where the watermark will appear
 * on their export, with two removal options:
 *   1. One-time removal for $2 ($1 launch promo)
 *   2. Upgrade to Pro (removes watermark permanently + unlocks all features)
 */

import React from 'react';
import { Crown, Tag } from 'lucide-react';
import { useAuth } from '../lib/auth-context';

interface WatermarkPreviewProps {
  show: boolean;
}

export const WatermarkPreview: React.FC<WatermarkPreviewProps> = ({ show }) => {
  const { user, createCheckout, removeWatermark } = useAuth();
  const tier = user?.tier || 'free';

  if (!show || tier !== 'free') return null;

  return (
    <div className="mt-3 p-3 bg-yellow-500/5 border border-yellow-500/20 rounded-xl space-y-3">
      <div className="flex items-center gap-2">
        <div className="px-2 py-1 bg-black/40 border border-white/10 rounded text-[9px] font-mono text-white/60">
          Made with PackShot
        </div>
        <span className="text-[10px] font-mono text-yellow-400 uppercase tracking-widest">
          Watermark (diagonal pattern)
        </span>
      </div>

      <p className="text-[9px] text-gray-600 font-mono">
        Free tier exports include a watermark. Choose how to remove it:
      </p>

      <div className="grid grid-cols-2 gap-2">
        {user ? (
          <button
            onClick={removeWatermark}
            className="flex flex-col items-center gap-1 px-3 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg transition-colors text-center group"
          >
            <div className="flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-green-400" />
              <span className="text-[10px] font-bold text-white uppercase tracking-widest">One-time</span>
            </div>
            <div className="flex items-baseline gap-1">
              <span className="text-xs font-bold text-green-400">$1</span>
              <span className="text-[9px] text-gray-500 line-through">$2</span>
            </div>
            <span className="text-[8px] text-gray-600 font-mono">Launch promo</span>
          </button>
        ) : (
          <div className="flex flex-col items-center gap-1 px-3 py-2.5 bg-white/5 border border-white/10 rounded-lg text-center opacity-50">
            <div className="flex items-center gap-1.5">
              <Tag className="w-3 h-3 text-green-400" />
              <span className="text-[10px] font-bold text-white uppercase tracking-widest">One-time</span>
            </div>
            <span className="text-[8px] text-gray-600 font-mono">Sign in to use</span>
          </div>
        )}

        <button
          onClick={() => createCheckout('pro')}
          className="flex flex-col items-center gap-1 px-3 py-2.5 bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/30 rounded-lg transition-colors text-center"
        >
          <div className="flex items-center gap-1.5">
            <Crown className="w-3 h-3 text-orange-400" />
            <span className="text-[10px] font-bold text-orange-400 uppercase tracking-widest">Upgrade Pro</span>
          </div>
          <span className="text-xs font-bold text-orange-400">$19/mo</span>
          <span className="text-[8px] text-gray-500 font-mono">Unlimited, no watermark</span>
        </button>
      </div>
    </div>
  );
};

/**
 * AI Credits panel — shows credit status, buy buttons, and BYOK indicator.
 * Displayed in the generation panel near AI action buttons.
 */

import React, { useState } from 'react';
import { Coins, Key, Crown, ShoppingCart, Check } from 'lucide-react';
import { useAuth } from '../lib/auth-context';

const CREDIT_PACKS = [
  { amount: '50' as const, price: '$5', perCredit: '$0.10' },
  { amount: '120' as const, price: '$10', perCredit: '$0.08' },
  { amount: '300' as const, price: '$20', perCredit: '$0.07' },
];

export const AICreditsPanel: React.FC = () => {
  const { user, aiCredits, buyCredits, createCheckout } = useAuth();
  const [showBuyMenu, setShowBuyMenu] = useState(false);
  const tier = user?.tier || 'free';

  // Free tier — show upgrade prompt
  if (tier === 'free') {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-orange-500/5 border border-orange-500/20 rounded-xl">
        <Crown className="w-4 h-4 text-orange-500 shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-orange-400">
          AI requires Pro
        </span>
        <button
          onClick={() => createCheckout('pro')}
          className="ml-auto text-[10px] font-mono uppercase tracking-widest text-orange-500 hover:text-orange-400 underline underline-offset-2"
        >
          Upgrade
        </button>
      </div>
    );
  }

  // No credits data yet
  if (!aiCredits) return null;

  // Using BYOK
  if (aiCredits.hasBYOK) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-xl">
        <Key className="w-4 h-4 text-green-500 shrink-0" />
        <span className="text-[10px] font-mono uppercase tracking-widest text-green-400">
          Using your {aiCredits.byokProviders[0]?.toUpperCase() || 'AI'} key
        </span>
        <Check className="w-3 h-3 text-green-500 ml-auto" />
      </div>
    );
  }

  // Show credits status
  return (
    <div className="relative">
      <div className="flex items-center gap-3 px-3 py-2 bg-white/5 border border-white/10 rounded-xl">
        <Coins className="w-4 h-4 text-orange-500 shrink-0" />
        <div className="flex flex-col">
          <span className="text-[10px] font-mono uppercase tracking-widest text-gray-400">
            AI Credits
          </span>
          <span className={`text-xs font-bold font-mono ${
            aiCredits.available > 10 ? 'text-white' :
            aiCredits.available > 0 ? 'text-yellow-400' : 'text-red-400'
          }`}>
            {aiCredits.available} remaining
          </span>
        </div>
        <button
          onClick={() => setShowBuyMenu(!showBuyMenu)}
          className="ml-auto flex items-center gap-1.5 px-3 py-1.5 bg-orange-500/20 hover:bg-orange-500/30 text-orange-400 rounded-lg transition-colors"
        >
          <ShoppingCart className="w-3 h-3" />
          <span className="text-[10px] font-mono uppercase tracking-widest">Buy</span>
        </button>
      </div>

      {/* Buy credits dropdown */}
      {showBuyMenu && (
        <div className="absolute top-full left-0 right-0 mt-2 bg-[#1a1b1f] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden">
          {CREDIT_PACKS.map(pack => (
            <button
              key={pack.amount}
              onClick={() => { buyCredits(pack.amount); setShowBuyMenu(false); }}
              className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors border-b border-white/5 last:border-0"
            >
              <div className="flex flex-col">
                <span className="text-xs font-bold text-white">{pack.amount} credits</span>
                <span className="text-[9px] text-gray-500 font-mono">{pack.perCredit}/credit</span>
              </div>
              <span className="text-sm font-bold text-orange-400">{pack.price}</span>
            </button>
          ))}
          <div className="px-4 py-2 bg-white/[0.02]">
            <p className="text-[9px] text-gray-600 font-mono">
              Credits never expire. Or add your own API key in settings.
            </p>
          </div>
        </div>
      )}
    </div>
  );
};

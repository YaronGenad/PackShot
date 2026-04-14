/**
 * User menu — shows user info, tier badge, and account actions in the header.
 * Shows login/register buttons for anonymous users.
 */

import React, { useState, useRef, useEffect } from 'react';
import { User, LogOut, CreditCard, Crown, ChevronDown, Zap, Key } from 'lucide-react';
import { useAuth } from '../lib/auth-context';
import { AuthModal } from './AuthModal';
import { BYOKSettings } from './BYOKSettings';

const TIER_COLORS = {
  free: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
  pro: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  studio: 'bg-purple-500/20 text-purple-400 border-purple-500/30',
};

const TIER_LABELS = {
  free: 'Free',
  pro: 'Pro',
  studio: 'Studio',
};

export const UserMenu: React.FC = () => {
  const { user, usage, loading, logout, openBillingPortal } = useAuth();
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authTab, setAuthTab] = useState<'login' | 'register'>('login');
  const [showDropdown, setShowDropdown] = useState(false);
  const [showBYOK, setShowBYOK] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (loading) {
    return (
      <div className="w-8 h-8 bg-white/5 rounded-full animate-pulse" />
    );
  }

  // Not logged in — show login/register buttons
  if (!user) {
    return (
      <>
        <div className="flex items-center gap-3">
          <button
            onClick={() => { setAuthTab('login'); setShowAuthModal(true); }}
            className="text-xs font-mono uppercase tracking-widest text-gray-400 hover:text-white transition-colors"
          >
            Sign In
          </button>
          <button
            onClick={() => { setAuthTab('register'); setShowAuthModal(true); }}
            className="px-4 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-mono uppercase tracking-widest rounded-lg transition-all active:scale-95"
          >
            Get Started
          </button>
        </div>
        <AuthModal
          isOpen={showAuthModal}
          onClose={() => setShowAuthModal(false)}
          defaultTab={authTab}
        />
      </>
    );
  }

  // Logged in — show user menu
  const tier = user.tier;
  const tierLimit = tier === 'free' ? 10 : tier === 'pro' ? 500 : 5000;
  const used = usage?.deterministic_count || 0;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className="flex items-center gap-3 px-3 py-2 bg-white/5 border border-white/10 rounded-xl hover:bg-white/10 transition-all"
      >
        <div className="w-8 h-8 bg-orange-500/20 rounded-full flex items-center justify-center">
          <User className="w-4 h-4 text-orange-500" />
        </div>
        <div className="hidden sm:flex flex-col items-start">
          <span className="text-xs text-white font-medium leading-none">{user.name}</span>
          <span className={`text-[9px] font-mono uppercase tracking-widest mt-1 px-1.5 py-0.5 rounded border ${TIER_COLORS[tier]}`}>
            {TIER_LABELS[tier]}
          </span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${showDropdown ? 'rotate-180' : ''}`} />
      </button>

      {showDropdown && (
        <div className="absolute right-0 top-full mt-2 w-72 bg-[#1a1b1f] border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50">
          {/* User Info */}
          <div className="p-4 border-b border-white/5">
            <p className="text-sm text-white font-medium">{user.name}</p>
            <p className="text-[10px] text-gray-500 font-mono mt-0.5">{user.email}</p>
          </div>

          {/* Usage */}
          <div className="p-4 border-b border-white/5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono uppercase tracking-widest text-gray-500">
                Images this month
              </span>
              <span className="text-xs text-white font-mono">{used}/{tierLimit}</span>
            </div>
            <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  used / tierLimit > 0.9 ? 'bg-red-500' : 'bg-orange-500'
                }`}
                style={{ width: `${Math.min(100, (used / tierLimit) * 100)}%` }}
              />
            </div>
          </div>

          {/* Actions */}
          <div className="p-2">
            <button
              onClick={() => { setShowDropdown(false); window.dispatchEvent(new CustomEvent('packshot:navigate', { detail: 'account' })); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:bg-white/5 rounded-lg transition-colors text-left"
            >
              <User className="w-4 h-4" />
              <span className="text-xs font-mono uppercase tracking-widest">My Account</span>
            </button>
            {tier === 'free' && (
              <button
                onClick={() => { setShowDropdown(false); window.dispatchEvent(new CustomEvent('packshot:navigate', { detail: 'pricing' })); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-orange-400 hover:bg-orange-500/10 rounded-lg transition-colors text-left"
              >
                <Crown className="w-4 h-4" />
                <span className="text-xs font-mono uppercase tracking-widest">Upgrade to Pro</span>
              </button>
            )}
            {tier === 'pro' && (
              <button
                onClick={() => { setShowDropdown(false); window.dispatchEvent(new CustomEvent('packshot:navigate', { detail: 'pricing' })); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors text-left"
              >
                <Zap className="w-4 h-4" />
                <span className="text-xs font-mono uppercase tracking-widest">Upgrade to Studio</span>
              </button>
            )}
            {tier !== 'free' && (
              <button
                onClick={() => { openBillingPortal(); setShowDropdown(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:bg-white/5 rounded-lg transition-colors text-left"
              >
                <CreditCard className="w-4 h-4" />
                <span className="text-xs font-mono uppercase tracking-widest">Manage Billing</span>
              </button>
            )}
            {tier !== 'free' && (
              <button
                onClick={() => { setShowBYOK(true); setShowDropdown(false); }}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:bg-white/5 rounded-lg transition-colors text-left"
              >
                <Key className="w-4 h-4" />
                <span className="text-xs font-mono uppercase tracking-widest">AI Provider Keys</span>
              </button>
            )}
            <button
              onClick={() => { logout(); setShowDropdown(false); }}
              className="w-full flex items-center gap-3 px-3 py-2.5 text-gray-400 hover:bg-white/5 rounded-lg transition-colors text-left"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-xs font-mono uppercase tracking-widest">Sign Out</span>
            </button>
          </div>
        </div>
      )}

      <BYOKSettings isOpen={showBYOK} onClose={() => setShowBYOK(false)} />
    </div>
  );
};

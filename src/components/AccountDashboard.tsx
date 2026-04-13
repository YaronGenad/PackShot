/**
 * Account dashboard — usage stats, AI credits, subscription management.
 */

import React from 'react';
import { BarChart3, Coins, Crown, Calendar, CreditCard, Key, Zap, ArrowLeft } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../lib/auth-context';

const TIER_LIMITS = {
  free: { images: 10, label: 'Free' },
  pro: { images: 500, label: 'Pro' },
  studio: { images: 5000, label: 'Studio' },
};

interface AccountDashboardProps {
  onBack: () => void;
  onOpenPricing: () => void;
  onOpenBYOK: () => void;
  onOpenRewards?: () => void;
}

export const AccountDashboard: React.FC<AccountDashboardProps> = ({ onBack, onOpenPricing, onOpenBYOK, onOpenRewards }) => {
  const { user, usage, subscription, aiCredits, openBillingPortal, buyCredits } = useAuth();

  if (!user) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-16 text-center">
        <p className="text-gray-500">Please sign in to view your account.</p>
        <button onClick={onBack} className="mt-4 text-orange-500 hover:text-orange-400 text-xs font-mono uppercase tracking-widest">
          &larr; Back
        </button>
      </div>
    );
  }

  const tier = user.tier;
  const limits = TIER_LIMITS[tier];
  const usedImages = usage?.deterministic_count || 0;
  const banked = usage?.banked_credits || 0;
  const totalAvailable = tier === 'pro' ? limits.images + banked : limits.images;
  const usagePercent = Math.min(100, (usedImages / totalAvailable) * 100);

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-gray-500 hover:text-white transition-colors mb-12"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back to App
      </button>

      {/* Header */}
      <div className="flex items-center justify-between mb-10">
        <div>
          <h2 className="text-3xl font-bold text-white uppercase tracking-tighter">Account</h2>
          <p className="text-gray-500 text-sm mt-1">{user.email}</p>
        </div>
        <div className={`px-4 py-2 rounded-xl text-xs font-mono uppercase tracking-widest border ${
          tier === 'studio' ? 'bg-purple-500/10 text-purple-400 border-purple-500/30' :
          tier === 'pro' ? 'bg-orange-500/10 text-orange-400 border-orange-500/30' :
          'bg-white/5 text-gray-400 border-white/10'
        }`}>
          {limits.label} Plan
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Image Usage */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4"
        >
          <div className="flex items-center gap-3">
            <BarChart3 className="w-5 h-5 text-orange-500" />
            <h3 className="text-sm font-bold text-white uppercase tracking-widest">Image Usage</h3>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-gray-400">This month</span>
              <span className="text-white">{usedImages} / {totalAvailable}</span>
            </div>
            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  usagePercent > 90 ? 'bg-red-500' : usagePercent > 70 ? 'bg-yellow-500' : 'bg-orange-500'
                }`}
                style={{ width: `${usagePercent}%` }}
              />
            </div>
            {tier === 'pro' && banked > 0 && (
              <p className="text-[10px] text-gray-500 font-mono">
                Includes {banked} banked credits from previous months
              </p>
            )}
          </div>
          {tier === 'free' && (
            <div className="flex flex-col gap-2">
              <button
                onClick={onOpenPricing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-xl transition-colors text-xs font-mono uppercase tracking-widest"
              >
                <Crown className="w-3.5 h-3.5" />
                Upgrade for more
              </button>
              {onOpenRewards && (
                <button
                  onClick={onOpenRewards}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl transition-colors text-xs font-mono uppercase tracking-widest"
                >
                  Earn free credits →
                </button>
              )}
            </div>
          )}
        </motion.div>

        {/* AI Credits */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4"
        >
          <div className="flex items-center gap-3">
            <Coins className="w-5 h-5 text-orange-500" />
            <h3 className="text-sm font-bold text-white uppercase tracking-widest">AI Credits</h3>
          </div>
          {tier === 'free' ? (
            <p className="text-sm text-gray-500">AI features require Pro or Studio tier.</p>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 bg-white/5 rounded-xl text-center">
                  <p className="text-lg font-bold text-white">{aiCredits?.available ?? '-'}</p>
                  <p className="text-[9px] font-mono text-gray-500 uppercase">Available</p>
                </div>
                <div className="p-3 bg-white/5 rounded-xl text-center">
                  <p className="text-lg font-bold text-white">{aiCredits?.used ?? 0}</p>
                  <p className="text-[9px] font-mono text-gray-500 uppercase">Used</p>
                </div>
                <div className="p-3 bg-white/5 rounded-xl text-center">
                  <p className="text-lg font-bold text-white">{aiCredits?.purchased ?? 0}</p>
                  <p className="text-[9px] font-mono text-gray-500 uppercase">Purchased</p>
                </div>
              </div>
              {tier === 'studio' && (
                <p className="text-[10px] text-gray-500 font-mono">
                  500 credits included monthly. Overage: $0.08/image.
                </p>
              )}
              {aiCredits?.hasBYOK && (
                <div className="flex items-center gap-2 px-3 py-2 bg-green-500/5 border border-green-500/20 rounded-lg">
                  <Key className="w-3.5 h-3.5 text-green-500" />
                  <span className="text-[10px] font-mono text-green-400 uppercase tracking-widest">
                    BYOK active — using your own key
                  </span>
                </div>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => buyCredits('120')}
                  className="flex-1 px-3 py-2 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-lg text-[10px] font-mono uppercase tracking-widest transition-colors"
                >
                  Buy Credits
                </button>
                <button
                  onClick={onOpenBYOK}
                  className="flex-1 px-3 py-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-lg text-[10px] font-mono uppercase tracking-widest transition-colors"
                >
                  Manage Keys
                </button>
              </div>
            </div>
          )}
        </motion.div>

        {/* Subscription */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4"
        >
          <div className="flex items-center gap-3">
            <Calendar className="w-5 h-5 text-orange-500" />
            <h3 className="text-sm font-bold text-white uppercase tracking-widest">Subscription</h3>
          </div>
          {subscription ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Status</span>
                <span className={`text-xs font-mono uppercase px-2 py-1 rounded ${
                  subscription.status === 'active' ? 'bg-green-500/10 text-green-400' :
                  subscription.status === 'past_due' ? 'bg-red-500/10 text-red-400' :
                  'bg-gray-500/10 text-gray-400'
                }`}>
                  {subscription.status}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-400">Renews</span>
                <span className="text-sm text-white font-mono">
                  {new Date(subscription.current_period_end).toLocaleDateString()}
                </span>
              </div>
              {subscription.cancel_at_period_end && (
                <p className="text-[10px] text-yellow-400 font-mono bg-yellow-500/5 p-2 rounded-lg">
                  Cancels at period end
                </p>
              )}
              <button
                onClick={openBillingPortal}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 text-gray-300 rounded-xl transition-colors text-xs font-mono uppercase tracking-widest"
              >
                <CreditCard className="w-3.5 h-3.5" />
                Manage Subscription
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-gray-500">No active subscription</p>
              <button
                onClick={onOpenPricing}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-xl transition-colors text-xs font-mono uppercase tracking-widest"
              >
                <Crown className="w-3.5 h-3.5" />
                View Plans
              </button>
            </div>
          )}
        </motion.div>

        {/* Studio API (only for Studio tier) */}
        {tier === 'studio' && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15 }}
            className="p-6 bg-white/[0.02] border border-white/5 rounded-2xl space-y-4"
          >
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-purple-500" />
              <h3 className="text-sm font-bold text-white uppercase tracking-widest">Studio API</h3>
            </div>
            <p className="text-sm text-gray-500">
              Use the REST API for automation. Rate limit: 100 req/min.
            </p>
            <div className="space-y-2 text-[10px] font-mono text-gray-400">
              <p>POST /api/v1/process — Upload &amp; extract</p>
              <p>POST /api/v1/stack — Focus stacking</p>
              <p>POST /api/v1/export — Format conversion</p>
              <p>POST /api/v1/ai/generate — AI packshot</p>
            </div>
            <p className="text-[9px] text-gray-600 font-mono">
              Manage API keys from the menu above.
            </p>
          </motion.div>
        )}
      </div>
    </div>
  );
};

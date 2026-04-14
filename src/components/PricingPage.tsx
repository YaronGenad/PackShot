/**
 * Pricing page — three-column tier comparison with monthly/annual toggle.
 */

import React, { useState } from 'react';
import { Check, X, Crown, Zap, Camera, Sparkles, Loader2 } from 'lucide-react';
import { motion } from 'motion/react';
import { useAuth } from '../lib/auth-context';
import { AuthModal } from './AuthModal';

const TIERS = [
  {
    id: 'free',
    name: 'Free',
    icon: <Camera className="w-6 h-6" />,
    monthlyPrice: 0,
    yearlyPrice: 0,
    description: 'Get started with basic focus stacking',
    features: [
      { text: '10 images/month', included: true },
      { text: 'Quick Stack + Aligned Stack', included: true },
      { text: 'JPEG + PNG export', included: true },
      { text: 'Max resolution: 2048px', included: true },
      { text: 'Watermark on exports', included: true },
      { text: 'AI Synthesis', included: false },
      { text: 'TIFF / PSD / WebP / AVIF', included: false },
      { text: 'Full sensor resolution', included: false },
      { text: 'API access', included: false },
    ],
    cta: 'Current Plan',
    accent: 'gray',
  },
  {
    id: 'pro',
    name: 'Pro',
    icon: <Crown className="w-6 h-6" />,
    monthlyPrice: 19,
    yearlyPrice: 200,
    description: 'For professional photographers',
    popular: true,
    features: [
      { text: '500 images/month (rollover)', included: true },
      { text: 'Quick Stack + Aligned Stack', included: true },
      { text: 'All export formats', included: true },
      { text: 'Full sensor resolution (8192px)', included: true },
      { text: 'No watermark', included: true },
      { text: 'AI Synthesis (credits or BYOK)', included: true },
      { text: 'Upload up to 20 files', included: true },
      { text: 'Priority queue', included: true },
      { text: 'API access', included: false },
    ],
    cta: 'Upgrade to Pro',
    accent: 'orange',
  },
  {
    id: 'studio',
    name: 'Studio',
    icon: <Zap className="w-6 h-6" />,
    monthlyPrice: 49,
    yearlyPrice: 500,
    description: 'For studios and automation',
    features: [
      { text: 'Unlimited images (5,000/mo soft)', included: true },
      { text: '500 AI credits included/month', included: true },
      { text: 'All export formats', included: true },
      { text: 'Full sensor resolution (8192px)', included: true },
      { text: 'No watermark', included: true },
      { text: 'REST API + webhooks', included: true },
      { text: 'Upload up to 50 files', included: true },
      { text: 'Priority support (24h)', included: true },
      { text: 'Custom export presets', included: true },
    ],
    cta: 'Upgrade to Studio',
    accent: 'purple',
  },
];

interface PricingPageProps {
  onBack: () => void;
}

export const PricingPage: React.FC<PricingPageProps> = ({ onBack }) => {
  const { user, createCheckout, changePlan } = useAuth();
  const [interval, setInterval] = useState<'month' | 'year'>('month');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [billingLoading, setBillingLoading] = useState(false);
  const currentTier = user?.tier || 'free';

  const handleCTA = async (tierId: string) => {
    if (tierId === 'free' || tierId === currentTier) return;
    if (!user) { setShowAuthModal(true); return; }
    setBillingLoading(true);
    try {
      // Existing paid subscribers changing between Pro and Studio use PayPal's
      // revise API so their current subscription is modified instead of creating
      // a second one (which would cause double billing).
      if (currentTier !== 'free') {
        await changePlan(tierId as 'pro' | 'studio', interval);
      } else {
        await createCheckout(tierId as 'pro' | 'studio', interval);
      }
    } finally {
      setBillingLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-6 py-16">
      {/* Back button */}
      <button
        onClick={onBack}
        className="text-xs font-mono uppercase tracking-widest text-gray-500 hover:text-white transition-colors mb-12"
      >
        &larr; Back to App
      </button>

      {/* Header */}
      <div className="text-center space-y-4 mb-12">
        <h2 className="text-4xl md:text-5xl font-bold text-white uppercase tracking-tighter">
          Choose Your Plan
        </h2>
        <p className="text-gray-500 text-lg max-w-xl mx-auto">
          From hobbyist to high-volume studio. Pick what fits.
        </p>
      </div>

      {/* Interval toggle */}
      <div className="flex items-center justify-center gap-4 mb-12">
        <button
          onClick={() => setInterval('month')}
          className={`px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-widest transition-all ${
            interval === 'month' ? 'bg-orange-500 text-white' : 'bg-white/5 text-gray-500 hover:text-white'
          }`}
        >
          Monthly
        </button>
        <button
          onClick={() => setInterval('year')}
          className={`px-4 py-2 rounded-lg text-xs font-mono uppercase tracking-widest transition-all relative ${
            interval === 'year' ? 'bg-orange-500 text-white' : 'bg-white/5 text-gray-500 hover:text-white'
          }`}
        >
          Annual
          <span className="absolute -top-2 -right-2 px-1.5 py-0.5 bg-green-500 text-[8px] text-white font-bold rounded-full">
            -15%
          </span>
        </button>
      </div>

      {/* Tier cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {TIERS.map((tier, idx) => {
          const price = interval === 'month' ? tier.monthlyPrice : tier.yearlyPrice;
          const isCurrentTier = currentTier === tier.id;
          const accentClasses = tier.accent === 'orange'
            ? 'border-orange-500/30 shadow-orange-500/10'
            : tier.accent === 'purple'
            ? 'border-purple-500/30 shadow-purple-500/10'
            : 'border-white/10';

          return (
            <motion.div
              key={tier.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: idx * 0.1 }}
              className={`relative rounded-2xl border bg-white/[0.02] p-8 space-y-6 ${accentClasses} ${
                tier.popular ? 'shadow-2xl ring-1 ring-orange-500/20' : ''
              }`}
            >
              {tier.popular && (
                <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-orange-500 text-white text-[9px] font-mono uppercase tracking-widest rounded-full">
                  Most Popular
                </div>
              )}

              {/* Tier header */}
              <div className="space-y-2">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${
                  tier.accent === 'orange' ? 'bg-orange-500/10 text-orange-500' :
                  tier.accent === 'purple' ? 'bg-purple-500/10 text-purple-500' :
                  'bg-white/5 text-gray-400'
                }`}>
                  {tier.icon}
                </div>
                <h3 className="text-xl font-bold text-white uppercase tracking-tight">{tier.name}</h3>
                <p className="text-sm text-gray-500">{tier.description}</p>
              </div>

              {/* Price */}
              <div className="flex items-baseline gap-1">
                <span className="text-4xl font-bold text-white">
                  {price === 0 ? 'Free' : `$${price}`}
                </span>
                {price > 0 && (
                  <span className="text-sm text-gray-500 font-mono">
                    /{interval === 'month' ? 'mo' : 'yr'}
                  </span>
                )}
              </div>

              {/* Features */}
              <ul className="space-y-3">
                {tier.features.map((feature, i) => (
                  <li key={i} className="flex items-center gap-3">
                    {feature.included ? (
                      <Check className={`w-4 h-4 shrink-0 ${
                        tier.accent === 'orange' ? 'text-orange-500' :
                        tier.accent === 'purple' ? 'text-purple-500' :
                        'text-green-500'
                      }`} />
                    ) : (
                      <X className="w-4 h-4 text-gray-700 shrink-0" />
                    )}
                    <span className={`text-sm ${feature.included ? 'text-gray-300' : 'text-gray-600'}`}>
                      {feature.text}
                    </span>
                  </li>
                ))}
              </ul>

              {/* CTA */}
              <button
                onClick={() => handleCTA(tier.id)}
                disabled={isCurrentTier || tier.id === 'free' || billingLoading}
                className={`w-full py-4 rounded-xl font-bold uppercase tracking-widest text-xs transition-all active:scale-95 flex items-center justify-center gap-2 ${
                  isCurrentTier
                    ? 'bg-white/5 text-gray-500 cursor-default'
                    : tier.accent === 'orange'
                    ? 'bg-orange-500 hover:bg-orange-600 text-white shadow-lg shadow-orange-500/20'
                    : tier.accent === 'purple'
                    ? 'bg-purple-500 hover:bg-purple-600 text-white shadow-lg shadow-purple-500/20'
                    : 'bg-white/5 text-gray-500 cursor-default'
                } ${billingLoading ? 'opacity-70 cursor-wait' : ''}`}
              >
                {billingLoading && !isCurrentTier && tier.id !== 'free' && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                {isCurrentTier ? 'Current Plan' : tier.cta}
              </button>
            </motion.div>
          );
        })}
      </div>

      {/* AI Credits info */}
      <div className="mt-12 text-center">
        <div className="inline-flex items-center gap-2 px-4 py-2 bg-white/[0.02] border border-white/5 rounded-xl">
          <Sparkles className="w-4 h-4 text-orange-500" />
          <span className="text-xs text-gray-400 font-mono">
            AI credits: 50/$5 · 120/$10 · 300/$20 — or use your own API key (BYOK)
          </span>
        </div>
      </div>

      <AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} defaultTab="register" />
    </div>
  );
};

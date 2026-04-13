import React, { useState, useEffect } from 'react';
import { Camera, Layers, Sparkles, Info, Github, ExternalLink, Cpu, Tag, LayoutDashboard, Gift, Menu, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { RawUploader } from './components/RawUploader';
import { PackshotGenerator } from './components/PackshotGenerator';
import { UserMenu } from './components/UserMenu';
import { PricingPage } from './components/PricingPage';
import { AccountDashboard } from './components/AccountDashboard';
import { BYOKSettings } from './components/BYOKSettings';
import { LegalPages } from './components/LegalPages';
import { RewardsPage } from './components/RewardsPage';
import { AuthModal } from './components/AuthModal';
import { useAuth } from './lib/auth-context';

type Page = 'home' | 'pricing' | 'account' | 'legal' | 'rewards';

export default function App() {
  const { user, refreshUser } = useAuth();
  const [page, setPage] = useState<Page>('home');
  const [processedImages, setProcessedImages] = useState<{ name: string, base64: string, mimeType: string }[]>([]);
  const [apiStatus, setApiStatus] = useState<'checking' | 'ok' | 'error'>('checking');
  const [showBYOK, setShowBYOK] = useState(false);
  const [paymentToast, setPaymentToast] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [showResetModal, setShowResetModal] = useState(false);
  const [cookieConsent, setCookieConsent] = useState(() => localStorage.getItem('cookie-consent') === 'accepted');

  // Auto-dismiss payment toast
  useEffect(() => {
    if (paymentToast) {
      const t = setTimeout(() => setPaymentToast(null), 5000);
      return () => clearTimeout(t);
    }
  }, [paymentToast]);

  // Listen for navigation events fired from deeply-nested components
  useEffect(() => {
    const handleNav = (e: any) => {
      const target = e.detail;
      if (target === 'rewards' || target === 'pricing' || target === 'account' || target === 'legal' || target === 'home') {
        setPage(target);
      }
    };
    window.addEventListener('packshot:navigate', handleNav);
    return () => window.removeEventListener('packshot:navigate', handleNav);
  }, []);

  // Handle password reset token from URL hash (Supabase redirects with #access_token=...)
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes('access_token=') && (hash.includes('type=recovery') || new URLSearchParams(window.location.search).get('reset-password'))) {
      const params = new URLSearchParams(hash.replace('#', ''));
      const token = params.get('access_token');
      if (token) {
        setResetToken(token);
        setShowResetModal(true);
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  // Handle PayPal return URLs and checkout query params on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const subscriptionId = params.get('subscription_id');
    const orderToken = params.get('token');

    if (subscriptionId) {
      // Subscription was approved — webhook will handle the tier update
      refreshUser().then(() => {
        setPage('account');
        setPaymentToast('Subscription activated! Welcome aboard.');
      });
      window.history.replaceState({}, '', window.location.pathname);
      return;
    }

    if (orderToken && !subscriptionId) {
      // One-time order approved — capture it. Determine type from URL params.
      const isWatermark = params.get('watermark') === 'removed';
      fetch('/api/billing/capture-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ orderId: orderToken }),
      }).then(() => refreshUser()).then(() => {
        if (isWatermark) {
          // Don't navigate — user stays on current page with their processed image intact
          setPaymentToast('Watermark credit added! Check the box below Download to use it.');
        } else {
          setPage('account');
          setPaymentToast('Payment successful!');
        }
        window.history.replaceState({}, '', window.location.pathname);
      }).catch(() => {
        window.history.replaceState({}, '', window.location.pathname);
      });
      return; // Don't fall through to the watermark check below
    }

    if (params.get('watermark') === 'removed' && !orderToken) {
      // Watermark return without token — don't navigate, just refresh rewards
      refreshUser().then(() => {
        setPaymentToast('Watermark credit added! Check the box below Download to use it.');
      });
      window.history.replaceState({}, '', window.location.pathname);
    } else if (params.get('checkout') === 'success' || params.get('credits') === 'success') {
      refreshUser().then(() => {
        setPage('account');
        setPaymentToast('Payment successful!');
      });
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

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
    <ErrorBoundary>
    <div className="min-h-screen bg-[#0a0b0d] text-gray-300 font-sans selection:bg-orange-500/30 selection:text-orange-200">

      {/* Payment success toast */}
      <AnimatePresence>
        {paymentToast && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] px-6 py-3 bg-green-500 text-white rounded-xl shadow-2xl text-sm font-bold"
          >
            {paymentToast}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Background Atmosphere */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-orange-500/5 blur-[120px] rounded-full" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/5 blur-[120px] rounded-full" />
        <div className="absolute inset-0 bg-[url('https://grainy-gradients.vercel.app/noise.svg')] opacity-20 mix-blend-overlay" />
      </div>

      {/* Header */}
      <header className="relative z-10 border-b border-white/5 bg-black/40 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <button onClick={() => setPage('home')} className="flex items-center space-x-4 group">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center shadow-lg shadow-orange-500/20 group-hover:scale-105 transition-transform">
              <Camera className="w-6 h-6 text-white" />
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-white uppercase tracking-tighter leading-none">RAW Packshot</h1>
              <span className="text-[10px] text-orange-500 font-mono uppercase tracking-[0.3em] mt-1">Studio Synthesizer v1.0</span>
            </div>
          </button>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="md:hidden text-gray-400 hover:text-white transition-colors p-2"
            aria-label="Toggle menu"
          >
            {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
          </button>

          <nav className="hidden md:flex items-center space-x-4">
            <button
              onClick={() => setPage('pricing')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-widest transition-colors ${
                page === 'pricing' ? 'bg-orange-500/10 text-orange-400' : 'text-gray-500 hover:text-white'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              Pricing
            </button>
            {user && (
              <>
                <button
                  onClick={() => setPage('rewards')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-widest transition-colors ${
                    page === 'rewards' ? 'bg-orange-500/10 text-orange-400' : 'text-gray-500 hover:text-white'
                  }`}
                >
                  <Gift className="w-3.5 h-3.5" />
                  Rewards
                </button>
                <button
                  onClick={() => setPage('account')}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono uppercase tracking-widest transition-colors ${
                    page === 'account' ? 'bg-orange-500/10 text-orange-400' : 'text-gray-500 hover:text-white'
                  }`}
                >
                  <LayoutDashboard className="w-3.5 h-3.5" />
                  Account
                </button>
              </>
            )}
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
            <div className="h-4 w-px bg-white/10" />
            <UserMenu />
          </nav>
        </div>
      </header>

      {/* Mobile Navigation Drawer */}
      <AnimatePresence>
        {mobileMenuOpen && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="relative z-10 md:hidden border-b border-white/5 bg-black/80 backdrop-blur-xl overflow-hidden"
          >
            <nav className="flex flex-col p-4 space-y-2">
              <button onClick={() => { setPage('pricing'); setMobileMenuOpen(false); }}
                className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-mono uppercase tracking-widest transition-colors ${page === 'pricing' ? 'bg-orange-500/10 text-orange-400' : 'text-gray-400 hover:text-white'}`}>
                <Tag className="w-4 h-4" /> Pricing
              </button>
              {user && (
                <>
                  <button onClick={() => { setPage('rewards'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-mono uppercase tracking-widest transition-colors ${page === 'rewards' ? 'bg-orange-500/10 text-orange-400' : 'text-gray-400 hover:text-white'}`}>
                    <Gift className="w-4 h-4" /> Rewards
                  </button>
                  <button onClick={() => { setPage('account'); setMobileMenuOpen(false); }}
                    className={`flex items-center gap-2 px-4 py-3 rounded-xl text-xs font-mono uppercase tracking-widest transition-colors ${page === 'account' ? 'bg-orange-500/10 text-orange-400' : 'text-gray-400 hover:text-white'}`}>
                    <LayoutDashboard className="w-4 h-4" /> Account
                  </button>
                </>
              )}
              <div className="pt-2 border-t border-white/5">
                <UserMenu />
              </div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Page Content */}
      <AnimatePresence mode="wait">
        {page === 'pricing' ? (
          <motion.main
            key="pricing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10"
          >
            <PricingPage onBack={() => setPage('home')} />
          </motion.main>
        ) : page === 'legal' ? (
          <motion.main
            key="legal"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10"
          >
            <LegalPages onBack={() => setPage('home')} />
          </motion.main>
        ) : page === 'account' ? (
          <motion.main
            key="account"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10"
          >
            <AccountDashboard
              onBack={() => setPage('home')}
              onOpenPricing={() => setPage('pricing')}
              onOpenBYOK={() => setShowBYOK(true)}
              onOpenRewards={() => setPage('rewards')}
            />
          </motion.main>
        ) : page === 'rewards' ? (
          <motion.main
            key="rewards"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10"
          >
            <RewardsPage onBack={() => setPage('home')} />
          </motion.main>
        ) : (
          <motion.main
            key="home"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative z-10 max-w-7xl mx-auto px-6 py-12 space-y-24"
          >
            {/* Hero Section */}
            <section className="text-center space-y-6 max-w-3xl mx-auto">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="inline-flex items-center space-x-2 px-4 py-2 bg-orange-500/10 border border-orange-500/20 rounded-full text-orange-400 text-[10px] font-mono uppercase tracking-[0.2em]"
              >
                <Cpu className="w-3 h-3" />
                <span>Multi-Provider AI — Gemini · OpenAI · Grok</span>
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
                  desc: "Choose your provider — Gemini, OpenAI, or Grok — for studio-quality packshots."
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
          </motion.main>
        )}
      </AnimatePresence>

      {/* Footer */}
      <footer className="relative z-10 border-t border-white/5 bg-black/40 backdrop-blur-xl mt-24">
        <div className="max-w-7xl mx-auto px-6 py-12 flex flex-col md:flex-row items-center justify-between space-y-6 md:space-y-0">
          <div className="flex items-center space-x-2 text-gray-600 text-[10px] font-mono uppercase tracking-widest">
            <span>© 2026 PackShot</span>
            <span className="px-2">·</span>
            <button onClick={() => setPage('pricing')} className="hover:text-white transition-colors">Pricing</button>
            <span className="px-2">·</span>
            <button onClick={() => setPage('legal')} className="hover:text-white transition-colors">Terms</button>
            <span className="px-2">·</span>
            <button onClick={() => setPage('legal')} className="hover:text-white transition-colors">Privacy</button>
          </div>

          <div className="flex items-center space-x-6">
            <a href="mailto:support@pack-shot.studio" className="text-gray-600 hover:text-white transition-colors text-[10px] font-mono uppercase tracking-widest">
              Support
            </a>
          </div>
        </div>
      </footer>

      {/* BYOK Modal (accessible from account dashboard) */}
      <BYOKSettings isOpen={showBYOK} onClose={() => setShowBYOK(false)} />

      {/* Password Reset Modal (triggered from email link) */}
      {showResetModal && (
        <AuthModal
          isOpen={true}
          onClose={() => { setShowResetModal(false); setResetToken(null); }}
          resetToken={resetToken}
        />
      )}

      {/* Cookie Consent Banner */}
      {!cookieConsent && (
        <div className="fixed bottom-0 left-0 right-0 z-[150] bg-[#151619] border-t border-white/10 p-4 md:p-6">
          <div className="max-w-4xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
            <p className="text-xs text-gray-400 text-center md:text-left">
              We use essential cookies for authentication and functionality. No tracking cookies are used.
              By continuing, you accept our{' '}
              <button onClick={() => setPage('legal')} className="text-orange-400 hover:text-orange-300 underline">Privacy Policy</button>.
            </p>
            <button
              onClick={() => { setCookieConsent(true); localStorage.setItem('cookie-consent', 'accepted'); }}
              className="shrink-0 px-6 py-2 bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold uppercase tracking-widest rounded-lg transition-colors"
            >
              Accept
            </button>
          </div>
        </div>
      )}
    </div>
    </ErrorBoundary>
  );
}

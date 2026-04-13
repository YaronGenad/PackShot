/**
 * Auth modal — login/register with Cloudflare Turnstile CAPTCHA on registration.
 * After registration, user must confirm email before they can log in.
 */

import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { LogIn, UserPlus, X, AlertCircle, Eye, EyeOff, Mail, RefreshCw } from 'lucide-react';
import { Turnstile } from 'react-turnstile';
import { useAuth } from '../lib/auth-context';

const TURNSTILE_SITE_KEY = (import.meta as any).env?.VITE_TURNSTILE_SITE_KEY || '';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultTab?: 'login' | 'register';
  resetToken?: string | null;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, defaultTab = 'login', resetToken }) => {
  const { login, register } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>(defaultTab);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [confirmationSent, setConfirmationSent] = useState(false);
  const [confirmationEmail, setConfirmationEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [forgotPassword, setForgotPassword] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [resetMode, setResetMode] = useState(!!resetToken);
  const [newPassword, setNewPassword] = useState('');
  const [resetSuccess, setResetSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (tab === 'login') {
        const result = await login(email, password);
        if (!result.success) {
          setError(result.error || 'Login failed');
        } else {
          onClose();
        }
      } else {
        if (password.length < 8) {
          setError('Password must be at least 8 characters');
          setLoading(false);
          return;
        }
        // CAPTCHA required for registration (if site key configured)
        if (TURNSTILE_SITE_KEY && !captchaToken) {
          setError('Please complete the CAPTCHA verification');
          setLoading(false);
          return;
        }
        const result = await register(email, password, name, captchaToken || undefined);
        if (!result.success) {
          setError(result.error || 'Registration failed');
          // Reset CAPTCHA on failure
          setTurnstileKey(k => k + 1);
          setCaptchaToken(null);
        } else if (result.requiresConfirmation) {
          setConfirmationSent(true);
          setConfirmationEmail(email);
        } else {
          onClose();
        }
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResendConfirmation = async () => {
    setResending(true);
    setError('');
    try {
      const res = await fetch('/api/auth/resend-confirmation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: confirmationEmail }),
      });
      const data = await res.json();
      if (!res.ok) setError(data.error);
    } finally {
      setResending(false);
    }
  };

  const switchTab = (newTab: 'login' | 'register') => {
    setTab(newTab);
    setError('');
    setConfirmationSent(false);
    setCaptchaToken(null);
    setTurnstileKey(k => k + 1);
  };

  // Email confirmation sent — show success message
  if (confirmationSent) {
    return createPortal(
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div className="bg-[#151619] border border-white/10 rounded-2xl max-w-md w-full p-8 shadow-2xl text-center space-y-6">
          <div className="w-16 h-16 mx-auto bg-green-500/10 rounded-full flex items-center justify-center">
            <Mail className="w-8 h-8 text-green-500" />
          </div>

          <div className="space-y-2">
            <h2 className="text-xl font-bold text-white uppercase tracking-tight">Check Your Email</h2>
            <p className="text-sm text-gray-400">
              We sent a confirmation link to <span className="text-white font-medium">{confirmationEmail}</span>
            </p>
            <p className="text-xs text-gray-500">Click the link in the email to activate your account, then come back and sign in.</p>
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-3">
            <button
              onClick={handleResendConfirmation}
              disabled={resending}
              className="w-full flex items-center justify-center gap-2 py-3 bg-white/5 hover:bg-white/10 text-gray-300 border border-white/10 rounded-xl transition-all text-xs font-mono uppercase tracking-widest"
            >
              <RefreshCw className={`w-4 h-4 ${resending ? 'animate-spin' : ''}`} />
              {resending ? 'Sending...' : 'Resend Confirmation Email'}
            </button>

            <button
              onClick={() => { setConfirmationSent(false); switchTab('login'); }}
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all text-xs font-bold uppercase tracking-widest"
            >
              Go to Sign In
            </button>

            <button
              onClick={onClose}
              className="text-xs text-gray-600 hover:text-gray-400 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      </div>,
      document.body
    );
  }

  // Password reset flow (user clicked link from email)
  if (resetMode && resetToken) {
    const handleResetPassword = async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setLoading(true);
      try {
        const res = await fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ access_token: resetToken, new_password: newPassword }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error); return; }
        setResetSuccess(true);
      } finally { setLoading(false); }
    };

    return createPortal(
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div className="bg-[#151619] border border-white/10 rounded-2xl max-w-md w-full p-8 shadow-2xl space-y-6">
          {resetSuccess ? (
            <>
              <h2 className="text-xl font-bold text-white uppercase tracking-tight text-center">Password Updated</h2>
              <p className="text-sm text-gray-400 text-center">Your password has been changed. You can now sign in.</p>
              <button
                onClick={() => { setResetMode(false); setResetSuccess(false); }}
                className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all text-xs font-bold uppercase tracking-widest"
              >Go to Sign In</button>
            </>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <h2 className="text-xl font-bold text-white uppercase tracking-tight text-center">Set New Password</h2>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">New Password</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="At least 8 characters" required minLength={8}
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-orange-500/50 transition-colors" autoFocus />
              </div>
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-4 rounded-xl transition-all uppercase tracking-widest text-xs">
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )}
        </div>
      </div>,
      document.body
    );
  }

  // Forgot password flow
  if (forgotPassword) {
    const handleForgotSubmit = async (e: React.FormEvent) => {
      e.preventDefault();
      setError('');
      setLoading(true);
      try {
        const res = await fetch('/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: forgotEmail }),
        });
        const data = await res.json();
        if (!res.ok) { setError(data.error); return; }
        setForgotSent(true);
      } finally { setLoading(false); }
    };

    return createPortal(
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
        <div className="bg-[#151619] border border-white/10 rounded-2xl max-w-md w-full p-8 shadow-2xl space-y-6">
          {forgotSent ? (
            <>
              <div className="w-16 h-16 mx-auto bg-green-500/10 rounded-full flex items-center justify-center">
                <Mail className="w-8 h-8 text-green-500" />
              </div>
              <h2 className="text-xl font-bold text-white uppercase tracking-tight text-center">Check Your Email</h2>
              <p className="text-sm text-gray-400 text-center">If an account exists for <span className="text-white font-medium">{forgotEmail}</span>, we sent a password reset link.</p>
              <button onClick={() => { setForgotPassword(false); setForgotSent(false); }}
                className="w-full py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all text-xs font-bold uppercase tracking-widest">
                Back to Sign In
              </button>
            </>
          ) : (
            <form onSubmit={handleForgotSubmit} className="space-y-4">
              <h2 className="text-xl font-bold text-white uppercase tracking-tight text-center">Reset Password</h2>
              <p className="text-sm text-gray-500 text-center">Enter your email and we'll send a reset link.</p>
              <div>
                <label className="block text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">Email</label>
                <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)} placeholder="you@example.com" required
                  className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-orange-500/50 transition-colors" autoFocus />
              </div>
              {error && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
                  <AlertCircle className="w-4 h-4 shrink-0" /><span>{error}</span>
                </div>
              )}
              <button type="submit" disabled={loading}
                className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-4 rounded-xl transition-all uppercase tracking-widest text-xs">
                {loading ? 'Sending...' : 'Send Reset Link'}
              </button>
              <button type="button" onClick={() => setForgotPassword(false)}
                className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors text-center">
                Back to Sign In
              </button>
            </form>
          )}
        </div>
      </div>,
      document.body
    );
  }

  return createPortal(
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[100] flex items-center justify-center p-4" role="dialog" aria-modal="true">
      <div className="bg-[#151619] border border-white/10 rounded-2xl max-w-md w-full p-8 shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-gray-500 hover:text-white transition-colors"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Tab Switcher */}
        <div className="flex mb-8 bg-white/5 rounded-xl p-1">
          <button
            onClick={() => switchTab('login')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-xs font-mono uppercase tracking-widest transition-all ${
              tab === 'login'
                ? 'bg-orange-500 text-white shadow-lg'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <LogIn className="w-4 h-4" />
            Sign In
          </button>
          <button
            onClick={() => switchTab('register')}
            className={`flex-1 flex items-center justify-center gap-2 py-3 rounded-lg text-xs font-mono uppercase tracking-widest transition-all ${
              tab === 'register'
                ? 'bg-orange-500 text-white shadow-lg'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            <UserPlus className="w-4 h-4" />
            Create Account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {tab === 'register' && (
            <div>
              <label className="block text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-orange-500/50 transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-orange-500/50 transition-colors"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-[10px] font-mono uppercase tracking-widest text-gray-500 mb-2">
              Password
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={tab === 'register' ? 'At least 8 characters' : 'Your password'}
                required
                minLength={tab === 'register' ? 8 : undefined}
                className="w-full px-4 py-3 pr-12 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-gray-600 focus:outline-none focus:border-orange-500/50 transition-colors"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </div>

          {/* Cloudflare Turnstile CAPTCHA — only on registration */}
          {tab === 'register' && TURNSTILE_SITE_KEY && (
            <div className="flex justify-center py-2">
              <Turnstile
                key={turnstileKey}
                sitekey={TURNSTILE_SITE_KEY}
                onVerify={(token: string) => setCaptchaToken(token)}
                onExpire={() => setCaptchaToken(null)}
                onError={() => setCaptchaToken(null)}
                theme="dark"
              />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading || (tab === 'register' && TURNSTILE_SITE_KEY && !captchaToken)}
            className="w-full bg-orange-500 hover:bg-orange-600 disabled:bg-gray-800 disabled:text-gray-600 text-white font-bold py-4 rounded-xl transition-all active:scale-95 uppercase tracking-widest text-xs shadow-lg shadow-orange-500/20"
          >
            {loading ? 'Please wait...' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        {tab === 'login' && (
          <div className="text-center mt-6 space-y-2">
            <p className="text-[10px] text-gray-600 font-mono uppercase tracking-widest">
              <button onClick={() => { setForgotPassword(true); setForgotEmail(email); }} className="text-gray-500 hover:text-orange-400 transition-colors">
                Forgot password?
              </button>
            </p>
            <p className="text-[10px] text-gray-600 font-mono uppercase tracking-widest">
              Don't have an account?{' '}
              <button onClick={() => switchTab('register')} className="text-orange-500 hover:text-orange-400">
                Create one
              </button>
            </p>
          </div>
        )}
        {tab === 'register' && (
          <p className="text-center text-[10px] text-gray-600 font-mono uppercase tracking-widest mt-6">
            Already have an account?{' '}
            <button onClick={() => switchTab('login')} className="text-orange-500 hover:text-orange-400">
              Sign in
            </button>
          </p>
        )}
      </div>
    </div>,
    document.body
  );
};

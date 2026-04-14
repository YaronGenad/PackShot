/**
 * Auth context — provides user state, login/register/logout functions,
 * and tier info to all components.
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';

interface User {
  id: string;
  email: string;
  name: string;
  tier: 'free' | 'pro' | 'studio';
}

interface Usage {
  month: string;
  deterministic_count: number;
  ai_count: number;
  ai_credits_purchased: number;
  banked_credits: number;
}

interface Subscription {
  status: string;
  tier: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
}

interface AICredits {
  available: number;
  included: number;
  purchased: number;
  used: number;
  hasBYOK: boolean;
  canPurchase: boolean;
  tier: string;
  byokProviders: string[];
}

interface RewardsStatus {
  watermarkExports: number;
  bonusAICredits: number;
  referralStats: { total: number; paid: number };
  claimedShares: string[];
  shareRewards: { facebook: number; linkedin: number; twitter: number };
}

interface AuthState {
  user: User | null;
  usage: Usage | null;
  subscription: Subscription | null;
  aiCredits: AICredits | null;
  rewards: RewardsStatus | null;
  loading: boolean;
  error: string | null;
}

interface AuthContextType extends AuthState {
  login: (email: string, password: string) => Promise<{ success: boolean; error?: string }>;
  register: (email: string, password: string, name?: string, captchaToken?: string) => Promise<{ success: boolean; error?: string; requiresConfirmation?: boolean }>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  refreshCredits: () => Promise<void>;
  refreshRewards: () => Promise<void>;
  createCheckout: (tier: 'pro' | 'studio', interval?: 'month' | 'year') => Promise<void>;
  changePlan: (tier: 'pro' | 'studio', interval?: 'month' | 'year') => Promise<void>;
  buyCredits: (pack: '50' | '120' | '300') => Promise<void>;
  removeWatermark: (onComplete?: () => void) => Promise<void>;
  openBillingPortal: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    usage: null,
    subscription: null,
    aiCredits: null,
    rewards: null,
    loading: true,
    error: null,
  });

  const fetchCredits = useCallback(async () => {
    try {
      const res = await fetch('/api/credits/status', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setState(prev => ({ ...prev, aiCredits: data }));
      }
    } catch {
      // Silently fail — credits are non-critical
    }
  }, []);

  const fetchRewards = useCallback(async () => {
    try {
      const res = await fetch('/api/rewards/status', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setState(prev => ({ ...prev, rewards: data }));
      }
    } catch {
      // Silently fail — rewards are non-critical
    }
  }, []);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setState({
          user: data.user,
          usage: data.usage,
          subscription: data.subscription,
          aiCredits: null,
          rewards: null,
          loading: false,
          error: null,
        });
        // Fetch credits and rewards separately (require auth)
        fetchCredits();
        fetchRewards();
      } else {
        setState(prev => ({ ...prev, user: null, usage: null, subscription: null, aiCredits: null, rewards: null, loading: false }));
      }
    } catch {
      setState(prev => ({ ...prev, loading: false }));
    }
  }, [fetchCredits, fetchRewards]);

  useEffect(() => {
    // Capture referral code from URL (stored until registration completes)
    try {
      const params = new URLSearchParams(window.location.search);
      const ref = params.get('ref');
      if (ref && /^pk_[a-zA-Z0-9]{4,20}$/.test(ref)) {
        localStorage.setItem('packshot_ref', ref);
        document.cookie = `packshot_ref=${ref}; path=/; max-age=${30 * 24 * 3600}; SameSite=Lax`;
      }
    } catch (_) {}
    fetchUser();
  }, [fetchUser]);

  const login = async (email: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error };
      }
      await fetchUser();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: 'Network error' };
    }
  };

  const register = async (email: string, password: string, name?: string, captchaToken?: string) => {
    try {
      // Include stored referral code (if any) from URL capture
      const referralCode = localStorage.getItem('packshot_ref') || undefined;

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ email, password, name, captchaToken, referralCode }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error };
      }
      // Clear stored ref on successful registration (regardless of confirmation)
      try { localStorage.removeItem('packshot_ref'); } catch (_) {}
      if (data.requiresConfirmation) {
        return { success: true, requiresConfirmation: true };
      }
      await fetchUser();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: 'Network error' };
    }
  };

  const logout = async () => {
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
    } catch (err) {
      console.warn('logout: server call failed, clearing local state anyway', err);
    }
    setState({ user: null, usage: null, subscription: null, aiCredits: null, rewards: null, loading: false, error: null });
    // Hard reload so any cached auth state in deeply-nested components is reset
    window.location.href = '/';
  };

  const createCheckout = async (tier: 'pro' | 'studio', interval: 'month' | 'year' = 'month') => {
    try {
      const res = await fetch('/api/billing/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tier, interval }),
      });
      const data = await res.json();
      if (!res.ok) { console.error('Checkout error:', data.error); return; }
      if (data.url) window.location.href = data.url;
    } catch (err) {
      console.error('Checkout failed:', err);
    }
  };

  const buyCredits = async (pack: '50' | '120' | '300') => {
    try {
      const res = await fetch('/api/billing/buy-credits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ pack }),
      });
      const data = await res.json();
      if (!res.ok) { console.error('Buy credits error:', data.error); return; }
      if (data.url) window.location.href = data.url;
    } catch (err) {
      console.error('Buy credits failed:', err);
    }
  };

  const removeWatermark = async (onComplete?: () => void) => {
    try {
      const res = await fetch('/api/billing/remove-watermark', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      const data = await res.json();
      if (!res.ok) { console.error('Watermark removal error:', data.error); return; }
      if (data.url) {
        // Open PayPal in popup — page stays intact, no navigation
        const popup = window.open(data.url, 'paypal_watermark', 'width=500,height=700,left=200,top=100');
        // Poll for popup close — server captures the order via popup-return route
        const pollTimer = setInterval(() => {
          if (!popup || popup.closed) {
            clearInterval(pollTimer);
            // Popup closed — server already captured via popup-return route.
            // Wait 1.5s for DB write, then trigger the callback (auto-download)
            setTimeout(() => {
              fetchRewards();
              if (onComplete) onComplete();
            }, 1500);
          }
        }, 500);
      }
    } catch (err) {
      console.error('Watermark removal failed:', err);
    }
  };

  const changePlan = async (tier: 'pro' | 'studio', interval: 'month' | 'year' = 'month') => {
    try {
      const res = await fetch('/api/billing/change-plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ tier, interval }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error('Change plan error:', data.error);
        alert(data.error || 'Failed to change plan');
        return;
      }
      if (data.url) window.location.href = data.url;
    } catch (err) {
      console.error('Change plan failed:', err);
      alert('Network error while changing plan');
    }
  };

  const openBillingPortal = async () => {
    // PayPal doesn't have a hosted portal — open their auto-pay management page.
    // Use a new tab so the PackShot session and in-progress work are preserved.
    const url = 'https://www.paypal.com/myaccount/autopay';
    const tab = window.open(url, '_blank', 'noopener,noreferrer');
    if (!tab) {
      // Popup blocker active — fall back to same-tab redirect
      window.location.href = url;
    }
  };

  return (
    <AuthContext.Provider value={{
      ...state,
      login,
      register,
      logout,
      refreshUser: fetchUser,
      refreshCredits: fetchCredits,
      refreshRewards: fetchRewards,
      createCheckout,
      changePlan,
      buyCredits,
      removeWatermark,
      openBillingPortal,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

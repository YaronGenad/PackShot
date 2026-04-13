/**
 * RewardsPage — social shares and referrals. Free-tier users earn watermark-free
 * exports and bonus AI credits by sharing and inviting. Pro/Studio users still
 * have access (useful if they want to help friends or earn the milestone reward).
 */

import React, { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import { ArrowLeft, Copy, Check, Facebook, Linkedin, Twitter, Gift, Users, Crown, Clock } from 'lucide-react';
import { useAuth } from '../lib/auth-context';

interface RewardsPageProps {
  onBack: () => void;
}

interface RewardsStatus {
  watermarkExports: number;
  bonusAICredits: number;
  referralStats: { total: number; paid: number };
  claimedShares: string[]; // ['share_facebook', ...]
  shareRewards: { facebook: number; linkedin: number; twitter: number };
}

interface ActiveClaim {
  id: string;
  source: string;
  watermark_exports_remaining: number;
  ai_credits_remaining: number;
  claimed_at: string;
  expires_at: string | null;
}

const SOURCE_LABELS: Record<string, string> = {
  share_facebook: 'Facebook share',
  share_linkedin: 'LinkedIn share',
  share_twitter: 'X / Twitter share',
  referral_free: 'Free signup referral',
  referral_paid: 'Paid signup referral',
  milestone_10_paid: '10 paid referrals milestone',
  purchase_watermark: 'One-time purchase',
};

export const RewardsPage: React.FC<RewardsPageProps> = ({ onBack }) => {
  const { user } = useAuth();
  const [status, setStatus] = useState<RewardsStatus | null>(null);
  const [referralLink, setReferralLink] = useState<string>('');
  const [claims, setClaims] = useState<ActiveClaim[]>([]);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const [claiming, setClaiming] = useState<string | null>(null);

  const loadData = async () => {
    try {
      const [statusRes, linkRes, claimsRes] = await Promise.all([
        fetch('/api/rewards/status', { credentials: 'include' }),
        fetch('/api/rewards/referral-link', { credentials: 'include' }),
        fetch('/api/rewards/active-claims', { credentials: 'include' }),
      ]);
      if (statusRes.ok) setStatus(await statusRes.json());
      if (linkRes.ok) setReferralLink((await linkRes.json()).url);
      if (claimsRes.ok) setClaims((await claimsRes.json()).claims || []);
    } catch (e) {
      console.error('Failed to load rewards data:', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) loadData();
  }, [user]);

  const handleShare = async (platform: 'facebook' | 'linkedin' | 'twitter') => {
    setClaiming(platform);
    const appUrl = referralLink || window.location.origin;
    const text = 'I just created stunning product photos with PackShot Studio — turn your RAW files into studio-quality packshots.';

    // Open share window
    let shareUrl = '';
    if (platform === 'facebook') {
      shareUrl = `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(appUrl)}`;
    } else if (platform === 'linkedin') {
      shareUrl = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(appUrl)}`;
    } else if (platform === 'twitter') {
      shareUrl = `https://twitter.com/intent/tweet?url=${encodeURIComponent(appUrl)}&text=${encodeURIComponent(text)}`;
    }
    window.open(shareUrl, '_blank', 'width=600,height=500');

    // Claim the reward
    try {
      const res = await fetch('/api/rewards/claim-share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ platform }),
      });
      if (res.ok || res.status === 409) {
        await loadData(); // refresh regardless
      }
    } finally {
      setClaiming(null);
    }
  };

  const copyReferralLink = async () => {
    await navigator.clipboard.writeText(referralLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const isClaimed = (platform: string) =>
    status?.claimedShares.includes(`share_${platform}`) || false;

  const milestoneProgress = Math.min(100, ((status?.referralStats.paid || 0) / 10) * 100);

  if (!user) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-16 text-center">
        <p className="text-gray-400">Please sign in to access rewards.</p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-6 py-12 space-y-8">
      {/* Header */}
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-gray-500 hover:text-white transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back
      </button>

      <div>
        <h1 className="text-4xl font-bold text-white uppercase tracking-tighter mb-2">
          Earn free credits
        </h1>
        <p className="text-gray-500 text-sm">
          Share PackShot or invite friends to earn watermark-free exports and bonus AI images.
        </p>
      </div>

      {loading ? (
        <div className="text-center py-16 text-gray-500">Loading...</div>
      ) : (
        <>
          {/* Stats row */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <StatCard icon={<Gift className="w-5 h-5" />} label="Watermark-free exports" value={status?.watermarkExports || 0} color="orange" />
            <StatCard icon={<Crown className="w-5 h-5" />} label="Bonus AI images" value={status?.bonusAICredits || 0} color="purple" />
            <StatCard icon={<Users className="w-5 h-5" />} label="Total referrals" value={status?.referralStats.total || 0} sub={`${status?.referralStats.paid || 0} paid`} color="blue" />
          </div>

          {/* Your referral link */}
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 space-y-3">
            <h3 className="text-xs font-mono uppercase tracking-widest text-gray-500">Your referral link</h3>
            <div className="flex gap-2">
              <input
                readOnly
                value={referralLink}
                className="flex-1 px-4 py-3 bg-black/40 border border-white/10 rounded-xl text-sm text-white font-mono"
                onClick={(e) => (e.target as HTMLInputElement).select()}
              />
              <button
                onClick={copyReferralLink}
                className="flex items-center gap-2 px-4 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-xl transition-all text-xs font-bold uppercase tracking-widest"
              >
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="text-[10px] text-gray-600 font-mono uppercase tracking-widest">
              When someone signs up through your link, you earn credits automatically.
            </p>
          </div>

          {/* Share to earn */}
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 space-y-4">
            <h3 className="text-xs font-mono uppercase tracking-widest text-gray-500">Share to earn</h3>
            <p className="text-[11px] text-gray-600">One-time reward per platform. No verification required.</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <ShareButton
                platform="facebook"
                icon={<Facebook className="w-5 h-5" />}
                label="Facebook"
                reward={status?.shareRewards.facebook || 2}
                claimed={isClaimed('facebook')}
                onClick={() => handleShare('facebook')}
                loading={claiming === 'facebook'}
              />
              <ShareButton
                platform="linkedin"
                icon={<Linkedin className="w-5 h-5" />}
                label="LinkedIn"
                reward={status?.shareRewards.linkedin || 4}
                claimed={isClaimed('linkedin')}
                onClick={() => handleShare('linkedin')}
                loading={claiming === 'linkedin'}
              />
              <ShareButton
                platform="twitter"
                icon={<Twitter className="w-5 h-5" />}
                label="X / Twitter"
                reward={status?.shareRewards.twitter || 2}
                claimed={isClaimed('twitter')}
                onClick={() => handleShare('twitter')}
                loading={claiming === 'twitter'}
              />
            </div>
          </div>

          {/* Referral rewards rules */}
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 space-y-3">
            <h3 className="text-xs font-mono uppercase tracking-widest text-gray-500">Referral rewards</h3>
            <ul className="space-y-2 text-sm text-gray-400">
              <li className="flex gap-3">
                <span className="text-orange-500 shrink-0">•</span>
                <span>Free user signs up: <span className="text-white">+1 watermark-free export</span> <span className="text-gray-600">(up to 10/month)</span></span>
              </li>
              <li className="flex gap-3">
                <span className="text-orange-500 shrink-0">•</span>
                <span>Paid user signs up: <span className="text-white">+10 watermark-free exports + 10 AI images</span> <span className="text-gray-600">(expires in 3 months)</span></span>
              </li>
              <li className="flex gap-3">
                <span className="text-orange-500 shrink-0">•</span>
                <span>Reach 10 paid referrals: <span className="text-white">1 free month of Pro</span></span>
              </li>
            </ul>
          </div>

          {/* Milestone progress */}
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-mono uppercase tracking-widest text-gray-500">Milestone: 10 paid referrals → 1 free Pro month</h3>
              <span className="text-xs font-mono text-orange-400">{status?.referralStats.paid || 0} / 10</span>
            </div>
            <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-orange-500 to-orange-400 rounded-full transition-all"
                style={{ width: `${milestoneProgress}%` }}
              />
            </div>
          </div>

          {/* Active claims */}
          {claims.length > 0 && (
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 space-y-3">
              <h3 className="text-xs font-mono uppercase tracking-widest text-gray-500">Active credits</h3>
              <div className="space-y-2">
                {claims.map((c) => (
                  <div key={c.id} className="flex items-center justify-between py-2 border-b border-white/5 last:border-0">
                    <div className="flex flex-col">
                      <span className="text-sm text-white">{SOURCE_LABELS[c.source] || c.source}</span>
                      <span className="text-[10px] text-gray-600 font-mono uppercase">
                        {new Date(c.claimed_at).toLocaleDateString()}
                        {c.expires_at && ` · expires ${new Date(c.expires_at).toLocaleDateString()}`}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs font-mono">
                      {c.watermark_exports_remaining > 0 && (
                        <span className="text-orange-400">{c.watermark_exports_remaining} exports</span>
                      )}
                      {c.ai_credits_remaining > 0 && (
                        <span className="text-purple-400">{c.ai_credits_remaining} AI</span>
                      )}
                      {c.expires_at && (
                        <Clock className="w-3 h-3 text-gray-600" />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

// ── Helper components ──────────────────────────────────────────────────────

const StatCard: React.FC<{ icon: React.ReactNode; label: string; value: number; sub?: string; color: 'orange' | 'purple' | 'blue' }> = ({
  icon, label, value, sub, color,
}) => {
  const colors = {
    orange: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    purple: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
    blue: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
  };
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`p-6 rounded-2xl border ${colors[color]}`}
    >
      <div className="flex items-center gap-2 mb-3 opacity-80">
        {icon}
        <span className="text-[10px] font-mono uppercase tracking-widest">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-bold">{value}</span>
        {sub && <span className="text-[10px] text-gray-500 font-mono uppercase">{sub}</span>}
      </div>
    </motion.div>
  );
};

const ShareButton: React.FC<{
  platform: string;
  icon: React.ReactNode;
  label: string;
  reward: number;
  claimed: boolean;
  loading: boolean;
  onClick: () => void;
}> = ({ icon, label, reward, claimed, loading, onClick }) => {
  return (
    <button
      onClick={onClick}
      disabled={claimed || loading}
      className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-all ${
        claimed
          ? 'bg-green-500/10 border-green-500/20 text-green-400 cursor-default'
          : 'bg-white/5 border-white/10 text-white hover:bg-white/10 hover:border-orange-500/30'
      }`}
    >
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-sm font-bold uppercase tracking-widest">{label}</span>
      </div>
      {claimed ? (
        <span className="text-[10px] font-mono uppercase tracking-widest">✓ Claimed</span>
      ) : (
        <span className="text-[10px] font-mono uppercase tracking-widest text-orange-400">
          +{reward} watermark-free exports
        </span>
      )}
    </button>
  );
};

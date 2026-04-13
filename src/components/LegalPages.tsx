/**
 * Legal pages — Terms of Service, Privacy Policy, Refund Policy.
 * Single component with tab switching.
 */

import React, { useState } from 'react';
import { ArrowLeft, Shield, FileText, CreditCard } from 'lucide-react';

type LegalTab = 'terms' | 'privacy' | 'refund';

interface LegalPagesProps {
  onBack: () => void;
  defaultTab?: LegalTab;
}

export const LegalPages: React.FC<LegalPagesProps> = ({ onBack, defaultTab = 'terms' }) => {
  const [tab, setTab] = useState<LegalTab>(defaultTab);

  const tabs = [
    { id: 'terms' as const, label: 'Terms of Service', icon: <FileText className="w-4 h-4" /> },
    { id: 'privacy' as const, label: 'Privacy Policy', icon: <Shield className="w-4 h-4" /> },
    { id: 'refund' as const, label: 'Refund Policy', icon: <CreditCard className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-16">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-gray-500 hover:text-white transition-colors mb-8"
      >
        <ArrowLeft className="w-3.5 h-3.5" />
        Back
      </button>

      {/* Tab selector */}
      <div className="flex gap-2 mb-10 overflow-x-auto">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-mono uppercase tracking-widest whitespace-nowrap transition-all ${
              tab === t.id
                ? 'bg-orange-500/10 text-orange-400 border border-orange-500/20'
                : 'bg-white/5 text-gray-500 border border-white/5 hover:text-white'
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        ))}
      </div>

      <div className="prose prose-invert prose-sm max-w-none prose-headings:uppercase prose-headings:tracking-tight prose-headings:text-white prose-p:text-gray-400 prose-p:leading-relaxed prose-li:text-gray-400 prose-strong:text-white prose-a:text-orange-400">
        {tab === 'terms' && <TermsOfService />}
        {tab === 'privacy' && <PrivacyPolicy />}
        {tab === 'refund' && <RefundPolicy />}
      </div>
    </div>
  );
};

function TermsOfService() {
  return (
    <div className="space-y-6">
      <h1>Terms of Service</h1>
      <p><strong>Effective date:</strong> April 4, 2026</p>

      <h2>1. Acceptance</h2>
      <p>By using PackShot ("the Service"), you agree to these Terms. If you do not agree, do not use the Service.</p>

      <h2>2. Service Description</h2>
      <p>PackShot is a web-based tool that converts camera RAW focus brackets into product packshot photographs using deterministic image processing and optional AI synthesis.</p>

      <h2>3. Accounts</h2>
      <ul>
        <li>You must provide accurate registration information.</li>
        <li>You are responsible for maintaining the security of your account credentials.</li>
        <li>One person or entity per account. Sharing accounts is not permitted.</li>
      </ul>

      <h2>4. Subscription Tiers</h2>
      <ul>
        <li><strong>Free:</strong> 10 images/month, JPEG + PNG export, watermark on output.</li>
        <li><strong>Pro ($19/mo or $200/yr):</strong> 500 images/month with rollover, all export formats, AI access via credits or BYOK.</li>
        <li><strong>Studio ($49/mo or $500/yr):</strong> Up to 5,000 images/month, 500 AI credits included, REST API access, webhooks.</li>
      </ul>

      <h2>5. Payments &amp; Billing</h2>
      <ul>
        <li>Payments are processed by Stripe. By subscribing you agree to Stripe's terms.</li>
        <li>Subscriptions auto-renew. Cancel anytime via the billing portal.</li>
        <li>AI credits are non-refundable once used. Unused purchased credits do not expire.</li>
      </ul>

      <h2>6. BYOK (Bring Your Own Key)</h2>
      <ul>
        <li>You may provide your own AI provider API keys. You are responsible for usage and costs on your provider account.</li>
        <li>PackShot encrypts stored keys at rest (AES-256) and never shares them with third parties.</li>
      </ul>

      <h2>7. Acceptable Use</h2>
      <p>You may not use the Service to process illegal content, circumvent access controls, or overload the system beyond fair use.</p>

      <h2>8. Intellectual Property</h2>
      <p>You retain all rights to images you upload and outputs you create. PackShot does not claim ownership of your content.</p>

      <h2>9. Limitation of Liability</h2>
      <p>PackShot is provided "as is." We are not liable for data loss, missed deadlines, or indirect damages arising from use of the Service.</p>

      <h2>10. Changes</h2>
      <p>We may update these Terms. Continued use after changes constitutes acceptance.</p>
    </div>
  );
}

function PrivacyPolicy() {
  return (
    <div className="space-y-6">
      <h1>Privacy Policy</h1>
      <p><strong>Effective date:</strong> April 4, 2026</p>

      <h2>1. Data We Collect</h2>
      <ul>
        <li><strong>Account data:</strong> email, name, password hash (managed by Supabase Auth).</li>
        <li><strong>Billing data:</strong> handled by Stripe. We store only your Stripe customer ID, not card numbers.</li>
        <li><strong>Usage data:</strong> image counts, AI credit usage, feature usage (for quota enforcement).</li>
        <li><strong>Images:</strong> uploaded temporarily for processing, then immediately deleted. We do not store your images.</li>
        <li><strong>BYOK keys:</strong> encrypted at rest (AES-256-CBC). Used only for API calls on your behalf.</li>
      </ul>

      <h2>2. How We Use Your Data</h2>
      <ul>
        <li>To provide and improve the Service.</li>
        <li>To enforce tier limits and usage quotas.</li>
        <li>To process payments and manage subscriptions.</li>
        <li>To send transactional emails (welcome, usage alerts, billing confirmations).</li>
      </ul>

      <h2>3. Data Sharing</h2>
      <ul>
        <li>We do not sell your personal data.</li>
        <li>We share data with: Supabase (database/auth), Stripe (payments), and your selected AI provider (BYOK keys, image data for processing).</li>
        <li>AI providers may have their own data retention policies. Check their terms when using BYOK.</li>
      </ul>

      <h2>4. Data Retention</h2>
      <ul>
        <li><strong>Uploaded images:</strong> deleted immediately after processing (not stored).</li>
        <li><strong>Account data:</strong> retained while account is active, deleted within 30 days of account deletion.</li>
        <li><strong>Usage data:</strong> retained for 12 months for billing and analytics.</li>
      </ul>

      <h2>5. Your Rights</h2>
      <p>You may request data export or deletion by contacting support. We comply with applicable data protection laws.</p>

      <h2>6. Security</h2>
      <p>We use HTTPS, encrypted storage, row-level security, and industry-standard practices. However, no system is 100% secure.</p>

      <h2>7. Cookies</h2>
      <p>We use httpOnly session cookies for authentication. No third-party tracking cookies are used.</p>
    </div>
  );
}

function RefundPolicy() {
  return (
    <div className="space-y-6">
      <h1>Refund Policy</h1>
      <p><strong>Effective date:</strong> April 4, 2026</p>

      <h2>Subscriptions</h2>
      <ul>
        <li>You may cancel your subscription at any time through the billing portal.</li>
        <li>Cancellation takes effect at the end of the current billing period — you retain access until then.</li>
        <li>Refunds for the current billing period are available within <strong>7 days</strong> of charge, prorated.</li>
        <li>No refunds after 7 days. Cancel before the next renewal to avoid charges.</li>
      </ul>

      <h2>AI Credits</h2>
      <ul>
        <li>Purchased AI credits are non-refundable once used.</li>
        <li>Unused purchased credits may be refunded within <strong>30 days</strong> of purchase.</li>
        <li>Included monthly credits (Studio tier) cannot be refunded separately.</li>
      </ul>

      <h2>Watermark Removal</h2>
      <ul>
        <li>One-time watermark removal purchases are non-refundable once the clean image has been delivered.</li>
      </ul>

      <h2>How to Request a Refund</h2>
      <p>Contact support with your account email and the charge date. Refunds are processed to the original payment method within 5-10 business days.</p>
    </div>
  );
}

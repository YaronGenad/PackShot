# PackShot — Frontend Billing Polish Sprint

> **Purpose:** Fix 10 gaps in the frontend billing flow so PayPal payments work end-to-end.
> The backend (PayPal routes, webhooks, iCount) is complete. This sprint fixes the frontend.
>
> **Repo:** https://github.com/YaronGenad/PackShot
> **Working directory:** `c:\Users\yaron\OneDrive - Newcinema\מאחד raw`

---

## Context — What's Already Done

The PayPal backend is complete:
- `src/lib/billing/paypal.ts` — PayPal REST client (auth, subscriptions, orders, verification)
- `src/lib/billing/routes.ts` — Full billing routes (create-checkout, buy-credits, remove-watermark, capture-order, webhook, cancel, status, sync)
- `src/lib/invoicing/icount.ts` — Israeli receipt generation
- PayPal Live products + plans created, webhook registered
- All Supabase migrations applied

The frontend components exist and mostly work, but an audit found these gaps:

---

## 10 Issues to Fix

### Issue 1: No auth guard before billing (CRITICAL)
**Problem:** PricingPage and UserMenu call `createCheckout()` without checking if user is logged in. Backend returns 401 but the user sees no feedback — the page just sits there.
**Files:** `src/components/PricingPage.tsx`, `src/components/UserMenu.tsx`
**Fix:**
- Import `AuthModal` component
- Add state: `const [showAuthModal, setShowAuthModal] = useState(false)`
- Before calling `createCheckout()`, check: `if (!user) { setShowAuthModal(true); return; }`
- Render `<AuthModal isOpen={showAuthModal} onClose={() => setShowAuthModal(false)} defaultTab="register" />` at the bottom of the component
- **Pattern to follow:** `src/components/PackshotGenerator.tsx` line ~135 already does this exact pattern.

### Issue 2: No refreshUser after PayPal return (CRITICAL)
**Problem:** After returning from PayPal, App.tsx redirects to account page but doesn't refresh the user data. The tier badge, usage counter, and rewards won't update until page reload.
**File:** `src/App.tsx` (lines 36-69)
**Fix:**
- Get `refreshUser` from `useAuth()` at the top of the App component (it's already destructured partially)
- After subscription return (line 44, before `setPage('account')`): call `await refreshUser()`
- After capture-order `.then()` (line 57): call `refreshUser()` before `setPage('account')`
- **Note:** `refreshUser` is already exported from auth-context.tsx as `fetchUser`

### Issue 3: Error handling in billing functions
**Problem:** `createCheckout`, `buyCredits`, `removeWatermark` in auth-context.tsx silently fail if the backend doesn't return a URL. User clicks button, nothing happens.
**File:** `src/lib/auth-context.tsx` (lines 198-237)
**Fix:**
- Wrap each function body in try/catch
- Check if `data.url` exists before redirecting
- If missing, log error and optionally alert user
- Example:
```typescript
const createCheckout = async (tier: 'pro' | 'studio', interval: 'month' | 'year' = 'month') => {
  try {
    const res = await fetch('/api/billing/create-checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ tier, interval }),
    });
    const data = await res.json();
    if (!res.ok) {
      console.error('Checkout error:', data.error);
      return;
    }
    if (data.url) {
      window.location.href = data.url;
    }
  } catch (err) {
    console.error('Checkout failed:', err);
  }
};
```
Do the same for `buyCredits` and `removeWatermark`.

### Issue 4: Watermark removal broken for anonymous users
**Problem:** In PackshotGenerator.tsx, when anonymous user clicks "$1 watermark removal", it calls `createCheckout('pro')` (Pro signup) instead of showing the auth modal.
**File:** `src/components/PackshotGenerator.tsx` (line ~1103)
**Current code:**
```typescript
onClick={() => { setShowWatermarkOptions(false); if (user) removeWatermark(); else createCheckout('pro'); }}
```
**Fix — change to:**
```typescript
onClick={() => { setShowWatermarkOptions(false); if (user) removeWatermark(); else setShowAuthModal(true); }}
```
The `showAuthModal` state and `<AuthModal>` component are already mounted in this file.

### Issue 5: Post-payment success toast
**Problem:** After returning from PayPal, user lands on account page with no feedback about what happened. They don't know if payment succeeded.
**File:** `src/App.tsx`
**Fix:**
- Add state: `const [paymentToast, setPaymentToast] = useState<string | null>(null)`
- In the PayPal return handler:
  - Subscription return → `setPaymentToast('Subscription activated! Welcome to Pro.')`
  - Order capture success → `setPaymentToast('Payment successful!')`
  - Watermark removed → `setPaymentToast('Watermark removed for your next export.')`
- Render a toast component (AnimatePresence + motion.div) at the top:
```tsx
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
```
- Auto-dismiss after 5 seconds: `useEffect(() => { if (paymentToast) { const t = setTimeout(() => setPaymentToast(null), 5000); return () => clearTimeout(t); } }, [paymentToast]);`

### Issue 6: AccountDashboard credit pack selector
**Problem:** The "Buy Credits" button in AccountDashboard is hardcoded to `buyCredits('120')`. Should show the 3 pack options.
**File:** `src/components/AccountDashboard.tsx`
**Fix:**
- Replace the hardcoded button with a dropdown similar to AICreditsPanel
- Or simpler: render the `<AICreditsPanel />` component in the dashboard instead of duplicating logic
- If using AICreditsPanel, just import and render it in the AI Credits section

### Issue 7: UserMenu — navigate to pricing instead of direct checkout
**Problem:** UserMenu "Upgrade to Pro" calls `createCheckout('pro')` directly with no interval choice. Annual option ($200/yr, 15% savings) is hidden.
**File:** `src/components/UserMenu.tsx` (lines 127-133)
**Fix:**
- Change the onClick handler from `createCheckout('pro')` to navigate to pricing page:
```typescript
onClick={() => {
  setShowDropdown(false);
  window.dispatchEvent(new CustomEvent('packshot:navigate', { detail: 'pricing' }));
}}
```
- Same for "Upgrade to Studio"
- The `packshot:navigate` event is already listened to in App.tsx (line 28)
- This way users see the full pricing comparison and can choose monthly/annual

### Issue 8: In-app cancellation
**Problem:** "Manage Billing" sends users to `https://www.paypal.com/myaccount/autopay` — confusing, no context about what to cancel.
**File:** `src/components/AccountDashboard.tsx`
**Fix:**
- Add a "Cancel Subscription" button next to or below "Manage Subscription"
- On click, show a confirmation dialog (modal or simple confirm()):
  ```
  "Are you sure you want to cancel your Pro subscription? 
  Your benefits continue until the end of the current billing period."
  ```
- If confirmed, POST to `/api/billing/cancel`:
  ```typescript
  const cancelSubscription = async () => {
    const res = await fetch('/api/billing/cancel', {
      method: 'POST',
      credentials: 'include',
    });
    if (res.ok) {
      refreshUser(); // tier will update
      // Show message: "Subscription cancelled. Pro access continues until [date]."
    }
  };
  ```
- The `/api/billing/cancel` endpoint already exists in the backend routes.
- After cancellation, update the UI to show "Cancels on [date]" (already handled via `cancel_at_period_end` flag)

### Issue 9: Billing history (NICE TO HAVE — lower priority)
**Problem:** No transaction history displayed.
**File:** `src/components/AccountDashboard.tsx`
**Fix (simple version):**
- Add a "Recent Activity" section at the bottom
- Fetch from `/api/rewards/active-claims` (already exists) to show reward claims
- Fetch subscription creation dates from Supabase
- Display as a simple list: date, type (subscription/credit/watermark), amount
- **For MVP:** Skip this — users can see their transactions in PayPal directly. Add later.

### Issue 10: Loading states on billing buttons
**Problem:** When user clicks "Subscribe to Pro", nothing visible happens for 1-2 seconds while the backend creates the PayPal session. No spinner.
**Files:** `src/components/PricingPage.tsx`, `src/components/AccountDashboard.tsx`
**Fix:**
- Add `const [billingLoading, setBillingLoading] = useState(false)` in each component
- Before calling createCheckout: `setBillingLoading(true)`
- Disable button and show Loader2 spinner while loading
- Since the page navigates away on success, the loading state auto-clears
- On error (catch block), `setBillingLoading(false)` to re-enable

---

## Implementation Order

1. **Issue 2** (refreshUser after PayPal return) — most impactful, 2 minutes
2. **Issue 4** (watermark anonymous fix) — one-line change
3. **Issue 1** (auth guard) — 5 minutes per component
4. **Issue 3** (error handling) — 5 minutes
5. **Issue 5** (success toast) — 10 minutes
6. **Issue 7** (UserMenu → pricing) — 2 minutes
7. **Issue 10** (loading states) — 5 minutes per component
8. **Issue 8** (cancellation UI) — 15 minutes
9. **Issue 6** (credit pack selector) — 5 minutes
10. **Issue 9** (billing history) — skip for now

---

## Files Reference

| File | Line(s) | What to change |
|------|---------|----------------|
| `src/App.tsx` | 36-69 | Add refreshUser + success toast |
| `src/lib/auth-context.tsx` | 198-237 | Error handling in billing functions |
| `src/components/PricingPage.tsx` | ~88 | Auth guard before createCheckout |
| `src/components/UserMenu.tsx` | 127-133 | Navigate to pricing instead of direct checkout |
| `src/components/AccountDashboard.tsx` | 162-168, 214-220 | Cancel button, credit selector |
| `src/components/PackshotGenerator.tsx` | ~1103 | Fix anonymous watermark removal |

## Existing Patterns to Reuse

- **Auth modal pattern:** PackshotGenerator.tsx line 135 — `if (!user) { setShowAuthModal(true); return; }`
- **Navigation events:** App.tsx line 28 — `window.dispatchEvent(new CustomEvent('packshot:navigate', { detail: 'pricing' }))`
- **AuthModal import:** `import { AuthModal } from './AuthModal';` — already used in UserMenu.tsx
- **refreshUser:** Available from `useAuth()` as `refreshUser` — already wired
- **AnimatePresence:** Already imported in App.tsx for page transitions
- **Loader2 spinner:** Already imported in multiple components from lucide-react

## Verification

After implementing all fixes, test these flows:

1. **Anonymous → PricingPage → Subscribe Pro** → AuthModal appears → register → after login, click Subscribe again → PayPal popup → pay → return → success toast → tier = Pro in header
2. **Anonymous → Generate packshot → auth gate works** (already tested, just verify it still works)
3. **Free user → Download JPEG → watermark applied** → click "Download without watermark → One-time $1" → PayPal → return → download again → no watermark
4. **Pro user → Buy 50 Credits** → PayPal → return → credits show in AICreditsPanel
5. **Pro user → Cancel** → confirmation → "Cancels on [date]" message → tier badge stays Pro until period end
6. **After every PayPal return** → tier badge, usage counter, rewards all update immediately (no page reload needed)

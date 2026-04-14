import { useEffect, useState, useCallback } from 'react';

type Tab = 'stats' | 'users' | 'detail';

interface Stats {
  users: { total: number; new_this_month: number };
  tiers: Record<string, number>;
  subscriptions: { active: number };
  mrr_usd: number;
  usage_this_month: { deterministic_stacks: number; ai_operations: number };
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  tier: string;
  created_at: string;
  pro_started_at: string | null;
  granted_pro_until: string | null;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { credentials: 'include', ...init });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
      <div className="text-xs uppercase tracking-wider text-neutral-400">{label}</div>
      <div className="text-3xl font-semibold text-white mt-2">{value}</div>
    </div>
  );
}

function StatsTab() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<Stats>('/api/admin/stats').then(setStats).catch((e) => setError(e.message));
  }, []);

  if (error) return <div className="text-red-400">Error: {error}</div>;
  if (!stats) return <div className="text-neutral-400">Loading…</div>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <StatCard label="Total users" value={stats.users.total} />
      <StatCard label="New this month" value={stats.users.new_this_month} />
      <StatCard label="Active subscriptions" value={stats.subscriptions.active} />
      <StatCard label="Free" value={stats.tiers.free || 0} />
      <StatCard label="Pro" value={stats.tiers.pro || 0} />
      <StatCard label="Studio" value={stats.tiers.studio || 0} />
      <StatCard label="MRR (USD)" value={`$${stats.mrr_usd}`} />
      <StatCard label="Stacks this month" value={stats.usage_this_month.deterministic_stacks} />
      <StatCard label="AI ops this month" value={stats.usage_this_month.ai_operations} />
    </div>
  );
}

function UsersTab({ onSelect }: { onSelect: (id: string) => void }) {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [search, setSearch] = useState('');
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams({ limit: '50', offset: '0' });
      if (search) qs.set('search', search);
      const data = await api<{ users: UserRow[]; total: number }>(`/api/admin/users?${qs}`);
      setUsers(data.users);
      setTotal(data.total);
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div>
      <div className="mb-4 flex gap-2">
        <input
          type="text"
          placeholder="Search by email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 bg-neutral-900 border border-neutral-800 rounded-lg px-4 py-2 text-white"
        />
        <div className="text-sm text-neutral-400 self-center">{total} users</div>
      </div>
      {loading ? (
        <div className="text-neutral-400">Loading…</div>
      ) : (
        <div className="border border-neutral-800 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-900 text-neutral-400 text-xs uppercase">
              <tr>
                <th className="text-left p-3">Email</th>
                <th className="text-left p-3">Tier</th>
                <th className="text-left p-3">Joined</th>
                <th className="p-3"></th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-neutral-800 hover:bg-neutral-900/50">
                  <td className="p-3 text-white">{u.email}</td>
                  <td className="p-3 text-neutral-300">{u.tier}</td>
                  <td className="p-3 text-neutral-400">{new Date(u.created_at).toLocaleDateString()}</td>
                  <td className="p-3">
                    <button onClick={() => onSelect(u.id)} className="text-orange-400 hover:text-orange-300">
                      View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function UserDetail({ userId, onBack }: { userId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<any>(null);
  const [grantCredits, setGrantCredits] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(() => {
    api<any>(`/api/admin/users/${userId}`).then(setDetail);
  }, [userId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleGrant = async () => {
    const credits = parseInt(grantCredits, 10);
    if (!credits || credits <= 0) return;
    setBusy(true);
    try {
      await api(`/api/admin/users/${userId}/grant-credits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits }),
      });
      setMessage(`Granted ${credits} AI credits`);
      setGrantCredits('');
      load();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const handleOverrideTier = async (tier: string) => {
    setBusy(true);
    try {
      await api(`/api/admin/users/${userId}/override-tier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      setMessage(`Tier set to ${tier}`);
      load();
    } catch (e: any) {
      setMessage(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  if (!detail) return <div className="text-neutral-400">Loading…</div>;

  return (
    <div>
      <button onClick={onBack} className="text-orange-400 hover:text-orange-300 mb-4">
        ← Back to users
      </button>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-3">Profile</h3>
          <pre className="text-xs text-neutral-300 overflow-x-auto">{JSON.stringify(detail.profile, null, 2)}</pre>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-3">Subscriptions ({detail.subscriptions.length})</h3>
          <pre className="text-xs text-neutral-300 overflow-x-auto">{JSON.stringify(detail.subscriptions, null, 2)}</pre>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-3">Usage (12 months)</h3>
          <pre className="text-xs text-neutral-300 overflow-x-auto">{JSON.stringify(detail.usage, null, 2)}</pre>
        </div>
        <div className="bg-neutral-900 border border-neutral-800 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-3">Reward claims ({detail.reward_claims.length})</h3>
          <pre className="text-xs text-neutral-300 overflow-x-auto">{JSON.stringify(detail.reward_claims, null, 2)}</pre>
        </div>
      </div>

      <div className="mt-6 bg-neutral-900 border border-neutral-800 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-3">Support actions</h3>
        {message && <div className="mb-3 text-sm text-orange-400">{message}</div>}

        <div className="flex gap-2 mb-3">
          <input
            type="number"
            placeholder="Credits"
            value={grantCredits}
            onChange={(e) => setGrantCredits(e.target.value)}
            className="bg-neutral-800 border border-neutral-700 rounded px-3 py-2 text-white w-32"
            disabled={busy}
          />
          <button
            onClick={handleGrant}
            disabled={busy}
            className="bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white px-4 py-2 rounded"
          >
            Grant AI credits
          </button>
        </div>

        <div className="flex gap-2">
          <span className="text-neutral-400 self-center text-sm">Override tier:</span>
          {(['free', 'pro', 'studio'] as const).map((t) => (
            <button
              key={t}
              onClick={() => handleOverrideTier(t)}
              disabled={busy}
              className="bg-neutral-800 hover:bg-neutral-700 disabled:opacity-50 text-white px-3 py-1 rounded text-sm"
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

export function AdminDashboard() {
  const [tab, setTab] = useState<Tab>('stats');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectUser = (id: string) => {
    setSelectedId(id);
    setTab('detail');
  };

  return (
    <div className="min-h-screen bg-black text-white p-6">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-semibold mb-6">PackShot Admin</h1>
        <nav className="flex gap-4 mb-6 border-b border-neutral-800">
          {(['stats', 'users'] as const).map((t) => (
            <button
              key={t}
              onClick={() => {
                setTab(t);
                setSelectedId(null);
              }}
              className={`pb-3 px-1 text-sm capitalize ${
                tab === t ? 'text-orange-400 border-b-2 border-orange-400' : 'text-neutral-400'
              }`}
            >
              {t}
            </button>
          ))}
        </nav>

        {tab === 'stats' && <StatsTab />}
        {tab === 'users' && <UsersTab onSelect={selectUser} />}
        {tab === 'detail' && selectedId && <UserDetail userId={selectedId} onBack={() => setTab('users')} />}
      </div>
    </div>
  );
}

export default AdminDashboard;

import { useEffect, useState, type FormEvent } from 'react';
import { signIn, signOut, syncNow, useSyncStatus, type SyncStatus } from '../lib/sync';
import { Button, Field, Icon } from './ui';

function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 45) return 'just now';
  if (s < 90) return 'a minute ago';
  if (s < 3600) return `${Math.round(s / 60)} minutes ago`;
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function describe(st: SyncStatus): { text: string; tone: 'ok' | 'busy' | 'warn' } {
  const waiting = st.pending ? ` · ${st.pending} change${st.pending === 1 ? '' : 's'} waiting` : '';
  switch (st.state) {
    case 'syncing':
      return { text: 'Syncing…', tone: 'busy' };
    case 'synced':
      return { text: `Up to date${st.lastSyncAt ? ` · ${ago(st.lastSyncAt)}` : ''}${waiting}`, tone: 'ok' };
    case 'offline':
      return { text: `Offline, will sync when you're back online${waiting}`, tone: 'warn' };
    case 'signed-out':
      return { text: 'Signed out on the server. Sign in again to keep syncing; your changes here are kept.', tone: 'warn' };
    case 'error':
      return { text: `Couldn't sync: ${st.error ?? 'unknown error'}. Trying again shortly.`, tone: 'warn' };
    default:
      return { text: '', tone: 'ok' };
  }
}

/** Settings → Sync: sign in with your account so every device shares one private library. */
export function SyncCard() {
  const st = useSyncStatus();
  const [, tick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  if (st.state === 'off' || st.state === 'signed-out') return <SignInForm status={st} />;

  const { text, tone } = describe(st);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <span className={`grid size-10 shrink-0 place-items-center rounded-2xl ${tone === 'warn' ? 'bg-amber-500/15 text-amber-600' : 'bg-soft text-soft-ink'}`}>
          <Icon name={tone === 'warn' ? 'cloud-off' : 'cloud'} className={`size-5 ${tone === 'busy' ? 'animate-pulse' : ''}`} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{st.email}</p>
          <p className="text-xs text-muted" aria-live="polite">
            {text}
          </p>
        </div>
      </div>
      <p className="text-xs text-muted">Your library, history, lists, categories and settings sync to every device you sign in on. Only your account can read them.</p>
      <div className="flex flex-wrap gap-2">
        <Button variant="soft" onClick={() => void syncNow()} disabled={st.state === 'syncing'}>
          Sync now
        </Button>
        <Button variant="ghost" onClick={() => void signOut()}>
          Sign out on this device
        </Button>
      </div>
    </div>
  );
}

function SignInForm({ status }: { status: SyncStatus }) {
  const [email, setEmail] = useState(status.email ?? '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      await signIn(email, password);
      setPassword('');
    } catch (err) {
      const m = (err as Error).message ?? String(err);
      setError(/invalid login/i.test(m) ? 'That email and password don’t match. It’s the same account you use for FitPip.' : !navigator.onLine ? 'You’re offline. Connect and try again.' : m);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="space-y-3">
      <p className="text-sm text-muted">
        {status.state === 'signed-out'
          ? describe(status).text
          : 'Sign in to keep your phone and computer in sync. Everything stays private to your account, and the app keeps working offline.'}
      </p>
      <Field label="Email">
        <input className="field" type="email" autoComplete="username" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </Field>
      <Field label="Password" hint="Same account as FitPip.">
        <input className="field" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </Field>
      {error && <p className="rounded-xl bg-red-500/12 p-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
      <Button type="submit" disabled={busy || !email || !password}>
        {busy ? 'Signing in…' : 'Sign in and sync'}
      </Button>
    </form>
  );
}

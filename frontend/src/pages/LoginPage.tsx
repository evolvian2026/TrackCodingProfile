import { useState, type FormEvent } from 'react';
import { BarChart3 } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { errorMessage } from '../api/client';
import { Callout, Spinner } from '../components/ui';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err, 'Sign-in failed'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand text-white">
            <BarChart3 className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="text-lg font-semibold tracking-tight text-ink">Coding Profile Tracker</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Student performance across LeetCode, CodeChef, HackerRank and Codeforces.
          </p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-5">
          {error && <Callout tone="danger">{error}</Callout>}

          <div>
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email" type="email" autoComplete="username" required autoFocus
              className="input" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="admin@tracker.local"
            />
          </div>

          <div>
            <label className="label" htmlFor="password">Password</label>
            <input
              id="password" type="password" autoComplete="current-password" required
              className="input" value={password} onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <button type="submit" className="btn-primary w-full" disabled={submitting}>
            {submitting && <Spinner />}
            {submitting ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="mt-4 text-center text-2xs text-ink-subtle">
          Administrator access only. Contact your training coordinator for an account.
        </p>
      </div>
    </div>
  );
}

import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, Loader2, Scissors } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { apiRequest } from '../lib/api';

export function LoginPage() {
  const { login } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'reset'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetNotice, setResetNotice] = useState<string | null>(null);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      notify('Signed in to CLIPFORGE.', 'success');
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to sign in.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setResetNotice(null);
    setSubmitting(true);
    try {
      const res = await apiRequest<{ message: string }>('/api/auth/request-reset', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
      setResetNotice(res.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request password reset.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090909] text-white flex flex-col justify-center px-4 py-12">
      <div className="w-full max-w-md mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to CLIPFORGE
        </Link>

        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-6 sm:p-8">
          <div className="flex items-center gap-2.5 mb-6">
            <span className="w-7 h-7 rounded-md bg-[#8B5CF6] flex items-center justify-center text-white">
              <Scissors className="w-4 h-4" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">CLIPFORGE</span>
          </div>

          {mode === 'login' ? (
            <>
              <h1 className="font-display text-xl font-bold text-white">Sign in to your studio</h1>
              <p className="mt-1.5 text-sm text-zinc-400">
                Access your projects, timelines, and exported clips.
              </p>

              {error && (
                <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
                  {error}
                </div>
              )}

              <form onSubmit={handleLogin} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="login-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Email address
                  </label>
                  <input
                    id="login-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="creator@studio.com"
                    className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label htmlFor="login-password" className="block text-xs font-medium text-zinc-300">
                      Password
                    </label>
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setMode('reset');
                      }}
                      className="text-xs text-[#8B5CF6] hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                  <input
                    id="login-password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Sign in
                </button>
              </form>

              <p className="mt-6 text-center text-xs text-zinc-400">
                New to CLIPFORGE?{' '}
                <Link to="/signup" className="text-white font-medium hover:underline">
                  Create an account
                </Link>
              </p>
            </>
          ) : (
            <>
              <h1 className="font-display text-xl font-bold text-white">Reset password</h1>
              <p className="mt-1.5 text-sm text-zinc-400">
                Enter your account email to check password reset availability.
              </p>

              {error && (
                <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
                  {error}
                </div>
              )}

              {resetNotice && (
                <div className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-200 leading-relaxed">
                  {resetNotice}
                </div>
              )}

              <form onSubmit={handleReset} className="mt-6 space-y-4">
                <div>
                  <label htmlFor="reset-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                    Email address
                  </label>
                  <input
                    id="reset-email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="creator@studio.com"
                    className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
                  />
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full py-2.5 px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Request reset
                </button>
              </form>

              <button
                type="button"
                onClick={() => {
                  setError(null);
                  setResetNotice(null);
                  setMode('login');
                }}
                className="mt-5 w-full text-center text-xs text-zinc-400 hover:text-white"
              >
                Back to sign in
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function SignupPage() {
  const { register } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();

  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    setSubmitting(true);
    try {
      await register(email, password, username);
      notify('Account created. Welcome to CLIPFORGE.', 'success');
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Registration failed.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090909] text-white flex flex-col justify-center px-4 py-12">
      <div className="w-full max-w-md mx-auto">
        <Link
          to="/"
          className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-white mb-8 transition-colors"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to CLIPFORGE
        </Link>

        <div className="bg-[#141414] border border-white/[0.08] rounded-xl p-6 sm:p-8">
          <div className="flex items-center gap-2.5 mb-6">
            <span className="w-7 h-7 rounded-md bg-[#8B5CF6] flex items-center justify-center text-white">
              <Scissors className="w-4 h-4" />
            </span>
            <span className="font-display text-lg font-bold tracking-tight">CLIPFORGE</span>
          </div>

          <h1 className="font-display text-xl font-bold text-white">Create your creator account</h1>
          <p className="mt-1.5 text-sm text-zinc-400">
            Start clipping long videos with AI transcription and FFmpeg export.
          </p>

          {error && (
            <div className="mt-4 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-200">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="signup-username" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Creator or studio name
              </label>
              <input
                id="signup-username"
                type="text"
                required
                minLength={2}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Alex Rivera"
                className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label htmlFor="signup-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Email address
              </label>
              <input
                id="signup-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="creator@studio.com"
                className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <div>
              <label htmlFor="signup-password" className="block text-xs font-medium text-zinc-300 mb-1.5">
                Password (minimum 8 characters)
              </label>
              <input
                id="signup-password"
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full rounded-lg bg-[#090909] border border-white/10 px-3.5 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:border-[#8B5CF6]"
              />
            </div>

            <button
              type="submit"
              disabled={submitting}
              className="w-full py-2.5 px-4 rounded-lg bg-[#8B5CF6] hover:bg-[#7C3AED] disabled:opacity-60 text-white text-sm font-semibold transition-colors flex items-center justify-center gap-2"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              Create account
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-zinc-400">
            Already have an account?{' '}
            <Link to="/login" className="text-white font-medium hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}

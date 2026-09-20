'use client';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { signIn, completeNewPasswordChallenge } from '@/utils/cognito/client';
import type { CognitoUser } from 'amazon-cognito-identity-js';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  // Set once Cognito responds with a NEW_PASSWORD_REQUIRED challenge (the
  // state every admin-created account starts in) — switches the form to
  // the "set a new password" step instead of redirecting.
  const [pendingUser, setPendingUser] = useState<CognitoUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');

  const finishLogin = () => {
    router.push('/');
    router.refresh();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const result = await signIn(email, password);
      if (result.type === 'newPasswordRequired') {
        setPendingUser(result.cognitoUser);
        return;
      }
      finishLogin();
    } catch (err: any) {
      console.error('Login error:', err);
      setError(err?.message || 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setError('Passwords do not match');
      return;
    }
    if (!pendingUser) return;

    setIsLoading(true);
    try {
      await completeNewPasswordChallenge(pendingUser, newPassword);
      finishLogin();
    } catch (err: any) {
      console.error('Set new password error:', err);
      setError(err?.message || 'An unexpected error occurred');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
      <img src="logo.svg" height={1000} width={1000} className='-left-100 fixed -z-10'></img>
      <div className="max-w-md w-full space-y-8">
        <h1 className="text-3xl font-bold text-center mb-6">Ramakrishna Vedanta Ashrama of Pittsburgh Library</h1>

        <Card className="w-full z-100">
          {pendingUser ? (
            <>
              <CardHeader>
                <CardTitle className="text-2xl text-center">Set a new password</CardTitle>
                <CardDescription className="text-center">
                  This is your first sign-in. Choose a new password to continue.
                </CardDescription>
              </CardHeader>
              <form onSubmit={handleSetNewPassword}>
                <CardContent className="grid gap-4">
                  <div className="grid gap-2">
                    <label htmlFor="newPassword" className="text-sm font-medium">New password</label>
                    <Input
                      id="newPassword"
                      type="password"
                      placeholder="Enter a new password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <label htmlFor="confirmNewPassword" className="text-sm font-medium">Confirm new password</label>
                    <Input
                      id="confirmNewPassword"
                      type="password"
                      placeholder="Re-enter the new password"
                      value={confirmNewPassword}
                      onChange={(e) => setConfirmNewPassword(e.target.value)}
                      required
                    />
                  </div>
                  {error && (
                    <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-200">
                      {error}
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Saving...' : 'Set password and sign in'}
                  </Button>
                </CardFooter>
              </form>
            </>
          ) : (
            <>
              <CardHeader>
                <CardTitle className="text-2xl text-center">Sign in</CardTitle>
              </CardHeader>
              <form onSubmit={handleSubmit}>
                <CardContent className="grid gap-4">
                  <div className="grid gap-2">
                    <label htmlFor="email" className="text-sm font-medium">Email</label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter your email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="grid gap-2">
                    <label htmlFor="password" className="text-sm font-medium">Password</label>
                    <Input
                      id="password"
                      type="password"
                      placeholder="Enter your password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  {error && (
                    <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-200">
                      {error}
                    </div>
                  )}
                </CardContent>
                <CardFooter>
                  <Button type="submit" className="w-full" disabled={isLoading}>
                    {isLoading ? 'Signing in...' : 'Sign in'}
                  </Button>
                </CardFooter>
              </form>
            </>
          )}
        </Card>

      </div>
    </div>
  );
}

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
import { CheckCircle2, Mail } from 'lucide-react';

const REGISTER_EMAIL = 'info@vedanta-pitt.org';
const REGISTER_MAILTO = `mailto:${REGISTER_EMAIL}?subject=${encodeURIComponent('Library catalog account request')}&body=${encodeURIComponent(
  "Hi,\n\nI'd like to register for an account on the RVAP library catalog.\n\nName:\nEmail:\n\nThanks!"
)}`;

const MEMBER_BENEFITS = [
  'Check out and return books online, right from the catalog',
  "Request a book that's already checked out — you'll be emailed the moment it's returned, with a 48-hour priority hold just for you",
  'See "My Checkouts": what you have, how long you\'ve had it, and your reminder history',
  'Change your own password any time from your account menu',
];

const ADMIN_BENEFITS = [
  'Add, edit, and remove catalog items',
  'Create accounts for new members and reset passwords',
  'See every checked-out book across all members, and who\'s waiting for each one',
  'Nudge a member by email to return a book someone else is waiting for',
];

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
      <div className="max-w-4xl w-full">
        <h1 className="text-3xl font-bold text-center mb-10">Ramakrishna Vedanta Ashrama of Pittsburgh Library</h1>

        <div className="grid md:grid-cols-2 gap-8 items-start">
          <div className="space-y-6">
            <Card className="w-full z-100">
              <CardHeader>
                <CardTitle className="text-xl">Why register?</CardTitle>
                <CardDescription>
                  Anyone can browse and search the catalog without an account. Registering unlocks a few more things.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">As a registered member, you can:</h3>
                  <ul className="space-y-2">
                    {MEMBER_BENEFITS.map((benefit) => (
                      <li key={benefit} className="flex gap-2 text-sm text-gray-700">
                        <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 mb-2">Library admins can also:</h3>
                  <ul className="space-y-2">
                    {ADMIN_BENEFITS.map((benefit) => (
                      <li key={benefit} className="flex gap-2 text-sm text-gray-700">
                        <CheckCircle2 className="h-4 w-4 text-blue-600 shrink-0 mt-0.5" />
                        <span>{benefit}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card className="w-full bg-blue-50 border-blue-200">
              <CardContent className="pt-6">
                <div className="flex gap-3">
                  <Mail className="h-5 w-5 text-blue-700 shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-sm font-semibold text-gray-900 mb-1">How to register</h3>
                    <p className="text-sm text-gray-700 mb-3">
                      Accounts aren't self-service — email the library and an admin will set one up for you and send
                      your login details.
                    </p>
                    <Button asChild size="sm" variant="outline" className="bg-white">
                      <a href={REGISTER_MAILTO}>Email {REGISTER_EMAIL}</a>
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

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
    </div>
  );
}

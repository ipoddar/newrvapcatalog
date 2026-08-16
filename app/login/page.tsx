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
import { signIn } from '@/utils/cognito/client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError('');

    try {
      const session = await signIn(email, password);
      const emailVerified = session.getIdToken().payload.email_verified;

      if (emailVerified === true || emailVerified === 'true') {
        router.push('/');
        router.refresh();
      } else {
        router.push('/verify-email');
      }
    } catch (err: any) {
      console.error('Login error:', err);
      if (err?.code === 'UserNotConfirmedException') {
        setError('Please check your email and enter the verification code before signing in.');
        router.push('/verify-email');
      } else {
        setError(err?.message || 'An unexpected error occurred');
      }
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
          
          <div className="px-6 pb-6">
            <div className="text-center text-sm text-gray-600">
              <Link href="/signup" className="text-primary hover:underline font-medium">
                Sign up here if you don't have an account
              </Link>
            </div>
          </div>
        </Card>
        
      </div>
    </div>
  );
}

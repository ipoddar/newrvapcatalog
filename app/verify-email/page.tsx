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
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { confirmSignUp, resendConfirmationCode } from '@/utils/cognito/client';

function VerifyEmailPageInner() {
    const [code, setCode] = useState('');
    const [isVerifying, setIsVerifying] = useState(false);
    const [isVerified, setIsVerified] = useState(false);
    const [error, setError] = useState('');
    const [resendLoading, setResendLoading] = useState(false);
    const [resendSuccess, setResendSuccess] = useState(false);
    const router = useRouter();
    const searchParams = useSearchParams();
    const email = searchParams.get('email') || '';

    const handleVerify = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email) {
            setError('Missing email address. Please sign up again.');
            return;
        }

        setIsVerifying(true);
        setError('');

        try {
            await confirmSignUp(email, code.trim());
            setIsVerified(true);
            setTimeout(() => {
                router.push('/login');
            }, 2000);
        } catch (err: any) {
            setError(err?.message || 'Verification failed. Please try again.');
        } finally {
            setIsVerifying(false);
        }
    };

    const handleResendEmail = async () => {
        setResendLoading(true);
        setResendSuccess(false);
        setError('');

        try {
            if (!email) {
                setError('Missing email address. Please sign up again.');
                return;
            }
            await resendConfirmationCode(email);
            setResendSuccess(true);
        } catch (err: any) {
            setError(err?.message || 'Failed to resend verification code.');
        } finally {
            setResendLoading(false);
        }
    };

    if (isVerified) {
        return (
            <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
                <div className="max-w-md w-full space-y-8">
                    <div className="text-center">
                        <p className="text-gray-600">Email verification successful!</p>
                    </div>

                    <Card className="w-full">
                        <CardHeader>
                            <CardTitle className="text-2xl text-center text-green-600">✅ Verified</CardTitle>
                            <CardDescription className="text-center">
                                Your email has been successfully verified
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="text-center space-y-4">
                            <p className="text-sm text-gray-600">
                                You will be redirected to sign in shortly.
                            </p>
                        </CardContent>
                        <CardFooter>
                            <Button asChild className="w-full">
                                <Link href="/login">Go to Sign In</Link>
                            </Button>
                        </CardFooter>
                    </Card>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen flex items-center justify-center py-12 px-4 sm:px-6 lg:px-8">
            <img src="logo.svg" height={1000} width={1000} className='-left-100 fixed -z-10'></img>
            <div className="max-w-md w-full space-y-8">

                <Card className="w-full">
                    <CardHeader>
                        <CardTitle className="text-2xl text-center">Email Verification</CardTitle>
                    </CardHeader>
                    <form onSubmit={handleVerify}>
                        <CardContent className="text-center space-y-4">
                            <p className="text-sm text-gray-600">
                                We sent a verification code to your email. Enter it below to activate your account.
                                Check your junk folder if you don't see it.
                            </p>

                            <Input
                                type="text"
                                placeholder="Enter verification code"
                                value={code}
                                onChange={(e) => setCode(e.target.value)}
                                required
                            />

                            {error && (
                                <div className="text-sm text-red-600 bg-red-50 p-3 rounded border border-red-200">
                                    {error}
                                </div>
                            )}

                            {resendSuccess && (
                                <div className="text-sm text-green-600 bg-green-50 p-3 rounded border border-green-200">
                                    Verification code has been resent!
                                </div>
                            )}
                        </CardContent>
                        <CardFooter className="flex flex-col gap-2">
                            <Button type="submit" className="w-full" disabled={isVerifying}>
                                {isVerifying ? 'Verifying...' : 'Verify Email'}
                            </Button>
                            <Button
                                type="button"
                                className="w-full"
                                variant="outline"
                                onClick={handleResendEmail}
                                disabled={resendLoading}
                            >
                                {resendLoading ? 'Resending...' : 'Resend Code'}
                            </Button>
                            <Button asChild className="w-full" variant="outline">
                                <Link href="/login">Back to Sign In</Link>
                            </Button>
                        </CardFooter>
                    </form>
                </Card>

                <div className="text-center text-sm text-gray-500">
                    <p>Report any issues to vivanneil@outlook.com</p>
                </div>
            </div>
        </div>
    );
}

export default function VerifyEmailPage() {
    return (
        <Suspense>
            <VerifyEmailPageInner />
        </Suspense>
    );
}

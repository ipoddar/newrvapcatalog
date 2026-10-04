'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { checkUserAdmin } from '@/lib/auth-utils';
import { apiUrl, authedRequestInit } from '@/utils/api-client';
import { fetchWithColdStartHint } from '@/utils/fetch-with-cold-start-hint';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableCell,
} from '@/components/ui/table';
import { AddUserModal, NewUser } from '@/components/ui/add-user-modal';
import { AdminCheckoutModal, AvailableBook } from '@/components/ui/admin-checkout-modal';
import { SetPasswordModal } from '@/components/ui/set-password-modal';
import { PlusCircle, KeyRound, BellRing } from 'lucide-react';
import { ReturnIcon, CheckoutIcon } from '@/components/icons';

interface CheckedOutBook {
  bookId: string;
  title: string;
  category: string;
  checkedOutAt: string;
  lastReminderSentAt: string | null;
  pendingRequestCount: number;
}

interface AdminUser {
  userId: string;
  email: string;
  name: string;
  isAdmin: string;
  status: string;
  createdAt: string;
  checkedOutBooks: CheckedOutBook[];
}

export default function AdminUsersPage() {
  const router = useRouter();
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [availableBooks, setAvailableBooks] = useState<AvailableBook[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isChecking, setIsChecking] = useState(true);

  const [isAddUserOpen, setAddUserOpen] = useState(false);
  const [isAddingUser, setIsAddingUser] = useState(false);
  const [addUserError, setAddUserError] = useState('');

  const [checkoutForUser, setCheckoutForUser] = useState<AdminUser | null>(null);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [returningBookId, setReturningBookId] = useState<string | null>(null);
  const [notifyingBookId, setNotifyingBookId] = useState<string | null>(null);

  const [passwordForUser, setPasswordForUser] = useState<AdminUser | null>(null);
  const [isSettingPassword, setIsSettingPassword] = useState(false);
  const [setPasswordError, setSetPasswordError] = useState('');

  const loadUsers = useCallback(async () => {
    const init = await authedRequestInit();
    const response = await fetch(apiUrl('/admin/users'), init);
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body?.error ?? 'Failed to load users');
    }
    setUsers(body.data ?? []);
  }, []);

  const loadAvailableBooks = useCallback(async () => {
    const init = await authedRequestInit();
    const response = await fetch(apiUrl('/catalog'), init);
    const body = await response.json();
    if (!response.ok) return;
    const catalog = (body.data ?? []) as Array<{
      id: string;
      title: string;
      category: string;
      firstname: string;
      lastname: string;
      isCheckedOut: boolean;
    }>;
    setAvailableBooks(
      catalog
        .filter((item) => !item.isCheckedOut)
        .map((item) => ({
          id: item.id,
          title: item.title,
          category: item.category,
          firstname: item.firstname,
          lastname: item.lastname,
        }))
    );
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function load() {
      const isAdmin = await checkUserAdmin();
      if (!isMounted) return;
      if (!isAdmin) {
        router.push('/unauthorized');
        return;
      }
      setIsChecking(false);

      try {
        await Promise.all([loadUsers(), loadAvailableBooks()]);
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Failed to load users');
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [router, loadUsers, loadAvailableBooks]);

  const handleAddUser = async (newUser: NewUser) => {
    setIsAddingUser(true);
    setAddUserError('');
    try {
      const init = await authedRequestInit({
        method: 'POST',
        body: JSON.stringify({
          email: newUser.email.trim(),
          firstName: newUser.firstName.trim(),
          lastName: newUser.lastName.trim(),
          password: newUser.password,
          isAdmin: newUser.isAdmin,
        }),
      });
      await fetchWithColdStartHint(apiUrl('/admin/users'), init, () => {});
      setAddUserOpen(false);
      await loadUsers();
    } catch (err) {
      setAddUserError(err instanceof Error ? err.message : 'Failed to create user');
    } finally {
      setIsAddingUser(false);
    }
  };

  const handleSetPassword = async (password: string) => {
    if (!passwordForUser) return;
    setIsSettingPassword(true);
    setSetPasswordError('');
    try {
      const init = await authedRequestInit({
        method: 'PUT',
        body: JSON.stringify({ password }),
      });
      await fetchWithColdStartHint(
        apiUrl(`/admin/users/${encodeURIComponent(passwordForUser.email)}/password`),
        init,
        () => {}
      );
      setPasswordForUser(null);
    } catch (err) {
      setSetPasswordError(err instanceof Error ? err.message : 'Failed to set password');
    } finally {
      setIsSettingPassword(false);
    }
  };

  const handleAdminCheckout = async (bookId: string) => {
    if (!checkoutForUser) return;
    setIsCheckingOut(true);
    try {
      const init = await authedRequestInit({
        method: 'POST',
        body: JSON.stringify({ onBehalfOfUserId: checkoutForUser.userId }),
      });
      const response = await fetch(apiUrl(`/catalog/${encodeURIComponent(bookId)}/checkout`), init);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to check out book');
      }
      setCheckoutForUser(null);
      await Promise.all([loadUsers(), loadAvailableBooks()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to check out book');
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleAdminReturn = async (bookId: string) => {
    setReturningBookId(bookId);
    try {
      const init = await authedRequestInit({ method: 'POST' });
      const response = await fetch(apiUrl(`/catalog/${encodeURIComponent(bookId)}/return`), init);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to return book');
      }
      await Promise.all([loadUsers(), loadAvailableBooks()]);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to return book');
    } finally {
      setReturningBookId(null);
    }
  };

  const handleNotifyHolder = async (bookId: string) => {
    setNotifyingBookId(bookId);
    try {
      const init = await authedRequestInit({ method: 'POST' });
      const response = await fetch(apiUrl(`/catalog/${encodeURIComponent(bookId)}/notify-holder`), init);
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body?.error ?? 'Failed to notify holder');
      }
      alert('The current holder has been emailed.');
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to notify holder');
    } finally {
      setNotifyingBookId(null);
    }
  };

  if (isChecking || isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="mt-4 text-gray-600">Loading users...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-24 text-red-600">
        Failed to load users: {error}
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-bold text-gray-900">Users & Checked-Out Books</h1>
        <Button onClick={() => setAddUserOpen(true)} className="flex items-center gap-2">
          <PlusCircle className="h-4 w-4" />
          Add User
        </Button>
      </div>

      <div className="overflow-x-auto border rounded-lg bg-white">
        <Table>
          <TableHeader>
            <TableRow className="border-b bg-gray-50">
              <TableCell isHeader className="px-4 py-2 text-left text-sm font-medium text-gray-600">User</TableCell>
              <TableCell isHeader className="px-4 py-2 text-left text-sm font-medium text-gray-600">Email</TableCell>
              <TableCell isHeader className="px-4 py-2 text-left text-sm font-medium text-gray-600">Role</TableCell>
              <TableCell isHeader className="px-4 py-2 text-left text-sm font-medium text-gray-600">Status</TableCell>
              <TableCell isHeader className="px-4 py-2 text-left text-sm font-medium text-gray-600">Checked-Out Books</TableCell>
              <TableCell isHeader className="px-4 py-2 text-left text-sm font-medium text-gray-600">Actions</TableCell>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.userId} className="border-b align-top">
                <TableCell className="px-4 py-3 text-sm text-gray-900">{user.name || '—'}</TableCell>
                <TableCell className="px-4 py-3 text-sm text-gray-600">{user.email}</TableCell>
                <TableCell className="px-4 py-3 text-sm">
                  {user.isAdmin === 'true' ? (
                    <Badge>Admin</Badge>
                  ) : (
                    <Badge variant="secondary">User</Badge>
                  )}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm text-gray-600">{user.status}</TableCell>
                <TableCell className="px-4 py-3 text-sm">
                  {user.checkedOutBooks.length === 0 ? (
                    <span className="text-gray-400">None</span>
                  ) : (
                    <div className="space-y-2">
                      {user.checkedOutBooks.map((book) => (
                        <div key={book.bookId} className="border-l-2 border-amber-300 pl-2 flex items-start justify-between gap-2">
                          <div>
                            <div className="font-medium text-gray-800">{book.title}</div>
                            <div className="text-xs text-gray-500">
                              {book.category} · checked out {new Date(book.checkedOutAt).toLocaleDateString()}
                              {book.lastReminderSentAt && (
                                <> · last reminder {new Date(book.lastReminderSentAt).toLocaleDateString()}</>
                              )}
                            </div>
                            {book.pendingRequestCount > 0 && (
                              <div className="text-xs text-blue-600 font-medium mt-0.5">
                                {book.pendingRequestCount} member{book.pendingRequestCount > 1 ? 's' : ''} waiting
                              </div>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            {book.pendingRequestCount > 0 && (
                              <div
                                title="Nudge the current holder to return this book"
                                onClick={() => !notifyingBookId && handleNotifyHolder(book.bookId)}
                                className={`p-1 border-blue-300 bg-blue-50 border rounded flex justify-center items-center transition duration-300 cursor-pointer ${
                                  notifyingBookId === book.bookId ? 'opacity-50' : 'hover:bg-blue-100'
                                }`}
                              >
                                <BellRing className="h-3.5 w-3.5 text-blue-600" />
                              </div>
                            )}
                            <div
                              title="Return this book"
                              onClick={() => !returningBookId && handleAdminReturn(book.bookId)}
                              className={`p-1 border-[#6b7280] border rounded flex justify-center items-center transition duration-300 cursor-pointer ${
                                returningBookId === book.bookId ? 'opacity-50' : 'hover:bg-blue-500'
                              }`}
                            >
                              <ReturnIcon height={14} color="#6b7280" />
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </TableCell>
                <TableCell className="px-4 py-3 text-sm">
                  <div className="flex items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-1"
                      onClick={() => setCheckoutForUser(user)}
                    >
                      <CheckoutIcon height={14} />
                      Check Out
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex items-center gap-1"
                      onClick={() => setPasswordForUser(user)}
                    >
                      <KeyRound className="h-3.5 w-3.5" />
                      Reset Password
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <AddUserModal
        isOpen={isAddUserOpen}
        onClose={() => {
          setAddUserOpen(false);
          setAddUserError('');
        }}
        onSave={handleAddUser}
        isSaving={isAddingUser}
      />
      {addUserError && (
        <p className="text-sm text-red-600 mt-2">{addUserError}</p>
      )}

      {checkoutForUser && (
        <AdminCheckoutModal
          isOpen={true}
          onClose={() => setCheckoutForUser(null)}
          onSave={handleAdminCheckout}
          books={availableBooks}
          userName={checkoutForUser.name || checkoutForUser.email}
          isSaving={isCheckingOut}
        />
      )}

      {passwordForUser && (
        <SetPasswordModal
          isOpen={true}
          onClose={() => {
            setPasswordForUser(null);
            setSetPasswordError('');
          }}
          onSave={handleSetPassword}
          userName={passwordForUser.name || passwordForUser.email}
          isSaving={isSettingPassword}
        />
      )}
      {setPasswordError && (
        <p className="text-sm text-red-600 mt-2">{setPasswordError}</p>
      )}
    </div>
  );
}

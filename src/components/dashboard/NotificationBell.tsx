'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  isRead: boolean;
  createdAt: string;
  link: string | null;
}

/**
 * AI-first listing workflow — the first real UI reader for the
 * Notification table/NotificationService (previously created rows with
 * no way to ever see them in the app). Fixed-position so it never has to
 * be threaded into DashboardHeader (mobile-only) AND DashboardSidebar
 * (desktop) separately — one component, works at every breakpoint,
 * zero changes to either existing layout file.
 */
export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  // Notification UX fix: a failed fetch must still never disrupt the rest
  // of the dashboard (no throw, no toast, no polling/retry loop) — but it
  // must also never be completely invisible. `error` only ever changes
  // what the OPEN panel itself shows (see below), and only when there is
  // nothing already loaded to show instead: an already-populated list from
  // a previous successful fetch is left exactly as it was on a later
  // failed background refresh, never replaced by an error state.
  const [error, setError] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/notifications');
      const data = await response.json();
      if (data.success) {
        setNotifications(data.notifications);
        setUnreadCount(data.unreadCount);
        setError(false);
      } else {
        setError(true);
      }
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  const handleToggle = () => {
    const next = !open;
    setOpen(next);
    if (next) fetchNotifications();
  };

  const markRead = async (id?: string) => {
    try {
      await fetch('/api/notifications', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(id ? { id } : {}),
      });
    } catch {
      // Silent — a failed mark-as-read must never block navigation.
    }
  };

  const handleItemClick = async (item: NotificationItem) => {
    if (!item.isRead) {
      setNotifications((prev) => prev.map((n) => (n.id === item.id ? { ...n, isRead: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
      await markRead(item.id);
    }
    setOpen(false);
    if (item.link) router.push(item.link);
  };

  const handleMarkAllRead = async () => {
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    setUnreadCount(0);
    await markRead();
  };

  return (
    <div ref={containerRef} className="fixed top-3 right-3 md:top-4 md:right-6 z-50">
      <button
        type="button"
        onClick={handleToggle}
        aria-label={unreadCount > 0 ? `Notifications (${unreadCount} non lues)` : 'Notifications'}
        aria-expanded={open}
        className="relative flex items-center justify-center w-10 h-10 rounded-full bg-[#0a0a0c]/90 backdrop-blur-md border border-white/[0.1] text-gray-300 hover:text-white transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60"
      >
        <Bell className="w-4.5 h-4.5" aria-hidden="true" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-[#FF5A1F] text-white text-[10px] font-semibold">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-w-[90vw] max-h-[70vh] overflow-y-auto rounded-2xl border border-white/[0.1] bg-[#0e0e11] shadow-xl">
          <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
            <span className="text-sm font-medium text-white">Notifications</span>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs text-gray-400 hover:text-white transition-colors"
              >
                Tout marquer comme lu
              </button>
            )}
          </div>

          {loading && notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">Chargement…</p>
          ) : error && notifications.length === 0 ? (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-gray-500">Impossible de charger les notifications.</p>
              <button
                type="button"
                onClick={fetchNotifications}
                className="mt-2 text-xs text-[#FF5A1F] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF5A1F]/60 rounded"
              >
                Réessayer
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <p className="px-4 py-6 text-sm text-gray-500 text-center">Aucune notification pour le moment.</p>
          ) : (
            <ul>
              {notifications.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => handleItemClick(item)}
                    className={`w-full text-left px-4 py-3 border-b border-white/[0.04] last:border-b-0 transition-colors hover:bg-white/[0.03] ${
                      item.isRead ? '' : 'bg-white/[0.02]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      {!item.isRead && <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[#FF5A1F] shrink-0" aria-hidden="true" />}
                      <div className="min-w-0">
                        <p className={`text-sm ${item.isRead ? 'text-gray-400' : 'text-white font-medium'}`}>{item.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{item.message}</p>
                      </div>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default NotificationBell;

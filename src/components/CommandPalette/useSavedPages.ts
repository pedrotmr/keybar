import { useCallback, useEffect, useRef, useState } from 'react';
import type { BookmarkItem, HistoryItem } from '@/types';
import { sendBackground } from '@/utils/chromeHelpers';
import { flattenBookmarks, toHistoryItems } from './helpers';

export function useSavedPages(permissions: Set<string>, notify: (message: string) => void) {
  const [bookmarks, setBookmarks] = useState<BookmarkItem[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const generation = useRef(0);
  const completed = useRef(new Set<string>());
  const pending = useRef<Promise<void> | null>(null);
  const notifyRef = useRef(notify);
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  const load = useCallback((allowed: Set<string>): Promise<void> => {
    if (pending.current) return pending.current;
    const version = generation.current;
    setLoading(true);
    const sources = ['bookmarks', 'history'].filter((source) => allowed.has(source) && !completed.current.has(source));
    const request = Promise.allSettled(
      sources.map(async (source) => {
        if (source === 'bookmarks') {
          const tree = await sendBackground('bookmarks:list');
          if (version !== generation.current) return;
          setBookmarks(flattenBookmarks(tree));
        } else {
          const entries = await sendBackground('history:list');
          if (version !== generation.current) return;
          setHistory(toHistoryItems(entries));
        }
        completed.current.add(source);
      }),
    )
      .then((results) => {
        if (version !== generation.current) return;
        if (results.some((result) => result.status === 'rejected')) {
          notifyRef.current('Some saved pages could not be loaded. Choose Search bookmarks and history to try again.');
        }
        setLoaded(completed.current.has('bookmarks') && completed.current.has('history'));
      })
      .finally(() => {
        if (version === generation.current) {
          pending.current = null;
          setLoading(false);
        }
      });
    pending.current = request;
    return request;
  }, []);

  const bookmarksAllowed = permissions.has('bookmarks');
  const historyAllowed = permissions.has('history');
  useEffect(() => {
    generation.current++;
    pending.current = null;
    completed.current.clear();
    setLoaded(false);
    setLoading(false);
    // Clear revoked data immediately and reject in-flight results from the old grant.
    if (!bookmarksAllowed) setBookmarks([]);
    if (!historyAllowed) setHistory([]);
    const allowed = new Set<string>();
    if (bookmarksAllowed) allowed.add('bookmarks');
    if (historyAllowed) allowed.add('history');
    if (allowed.size) void load(allowed);
    return () => {
      generation.current++;
    };
  }, [bookmarksAllowed, historyAllowed, load]);

  return {
    bookmarks: bookmarksAllowed ? bookmarks : [],
    history: historyAllowed ? history : [],
    localDataLoading: loading,
    localDataLoaded: loaded,
    loadLocalData: load,
  };
}

/**
 * The "link a new device" panel's state on the device already signed in.
 *
 * A link is as good as the account for as long as it is open, so it is
 * withdrawn whenever the panel stops showing it without the new device having
 * signed in: closed, left open past the server's ten minutes, or unmounted by
 * leaving the page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useAppStore } from "../../store";
import { findSavedPassword } from "../../serverStorage";
import type { AccountSettings } from "../../types";
import { beginDeviceLink, cancelDeviceLink, type DeviceLinkOffer } from "./deviceLink";

/** The server honours a link for ten minutes; the panel gives up just before. */
const OFFER_LIFETIME_MS = 9.5 * 60 * 1000;

export function useDeviceLinkOffer(snapshot: AccountSettings | null) {
  const [offer, setOffer] = useState<DeviceLinkOffer | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const live = useRef<DeviceLinkOffer | null>(null);
  live.current = offer;

  /** Whether the device the offer registered has signed in. */
  const linked =
    offer !== null && (snapshot?.devices ?? []).some((d) => d.id === offer.deviceId && d.last_seen_ms > 0);

  const withdraw = useCallback(async (target: DeviceLinkOffer | null) => {
    if (target) await cancelDeviceLink(target.deviceId).catch(() => undefined);
  }, []);

  const begin = useCallback(async () => {
    setStarting(true);
    setError(null);
    setExpired(false);
    try {
      const pending = useAppStore.getState().pendingConnect;
      const password = pending
        ? await findSavedPassword(pending.host, pending.port, pending.username).catch(() => null)
        : null;
      setOffer(await beginDeviceLink(password));
    } catch (e) {
      setError(String(e));
    } finally {
      setStarting(false);
    }
  }, []);

  /** Close the panel: a completed link stays, one nobody used is withdrawn. */
  const close = useCallback(async () => {
    const current = live.current;
    setOffer(null);
    if (!linked) await withdraw(current);
  }, [linked, withdraw]);

  useEffect(() => {
    if (!offer || linked) return;
    const timer = setTimeout(() => {
      void withdraw(live.current);
      setOffer(null);
      setExpired(true);
    }, OFFER_LIFETIME_MS);
    return () => clearTimeout(timer);
  }, [offer, linked, withdraw]);

  // Leaving the page with a link open is closing it.
  const linkedRef = useRef(linked);
  linkedRef.current = linked;
  useEffect(
    () => () => {
      const open = live.current;
      if (open && !linkedRef.current) void cancelDeviceLink(open.deviceId).catch(() => undefined);
    },
    [],
  );

  return { offer, starting, error, expired, linked, begin, close };
}

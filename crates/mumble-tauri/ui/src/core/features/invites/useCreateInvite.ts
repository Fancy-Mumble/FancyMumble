/**
 * The state behind an "Invite people" dialog, shared by every UI shell: the
 * two choices, the minted link, copying it, and what went wrong.
 */

import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { createInvite, InviteRefusedError, InviteTimeoutError, type Invite } from "./invitesApi";
import { lifetimeChoices, useLimitChoices } from "./inviteOptions";
import { inviteLinkFor, useInviteSupport } from "./useInviteSupport";

export function useCreateInvite(channelId: number, open: boolean) {
  const { t } = useTranslation("server");
  const support = useInviteSupport();
  const lifetimes = useMemo(() => lifetimeChoices(support), [support]);
  const useLimits = useMemo(() => useLimitChoices(support), [support]);
  const [lifetime, setLifetime] = useState(lifetimes.initial);
  const [maxUses, setMaxUses] = useState(useLimits.initial);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every opening starts over: a link minted for one channel must not be
  // shown again for the next.
  useEffect(() => {
    if (!open) return;
    setLifetime(lifetimes.initial);
    setMaxUses(useLimits.initial);
    setInvite(null);
    setLink(null);
    setCopied(false);
    setError(null);
  }, [open, channelId, lifetimes.initial, useLimits.initial]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const minted = await createInvite({ channelId, maxAgeS: lifetime, maxUses });
      setInvite(minted);
      setLink(inviteLinkFor(minted.code, support));
    } catch (reason) {
      if (reason instanceof InviteRefusedError) {
        const key = reason.reason === "notFound" || reason.reason === "invalid" ? "other" : reason.reason;
        setError(t(`invites.refused.${key}` as "invites.refused.other"));
      } else if (reason instanceof InviteTimeoutError) {
        setError(t("invites.refused.noAnswer"));
      } else {
        setError(String(reason));
      }
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return {
    support,
    lifetimes: lifetimes.choices,
    useLimits: useLimits.choices,
    lifetime,
    setLifetime,
    maxUses,
    setMaxUses,
    invite,
    link,
    busy,
    copied,
    error,
    create,
    copy,
  };
}

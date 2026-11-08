"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BellRing, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { deleteAlert } from "@/lib/actions/alert.actions";
import { alertsEnabled } from "@/lib/market-data";
import { formatPrice } from "@/lib/utils";

type AlertRow = {
    _id: string;
    symbol: string;
    targetPrice: number;
    condition: 'ABOVE' | 'BELOW';
    triggered?: boolean;
    active?: boolean;
    expiresAt?: string;
};

const statusOf = (alert: AlertRow) => {
    if (alert.triggered) return { label: 'Triggered', className: 'pill is-brand' };
    if (!alertsEnabled) return { label: 'Paused', className: 'pill' };
    if (alert.expiresAt && new Date(alert.expiresAt) < new Date()) return { label: 'Expired', className: 'pill' };
    if (alert.active === false) return { label: 'Paused', className: 'pill' };
    return { label: 'Watching', className: 'pill is-up' };
};

export default function AlertsPanel({ alerts }: { alerts: AlertRow[] }) {
    const router = useRouter();
    const [pendingId, setPendingId] = useState<string | null>(null);

    const handleDelete = async (alert: AlertRow) => {
        setPendingId(alert._id);
        try {
            await deleteAlert(alert._id);
            toast.success(`Alert for ${alert.symbol} removed`);
            router.refresh();
        } catch {
            toast.error("Couldn’t remove the alert");
        } finally {
            setPendingId(null);
        }
    };

    const active = alerts.filter((a) => !a.triggered).length;
    const sub = alertsEnabled ? `${active} active · checked every 5 minutes` : 'An OpenStock Cloud feature';

    // A slim strip rather than a tall card: a title block, then either one line of explanation or a row of alerts.
    return (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2.5">
            <div className="flex flex-none items-center gap-2.5">
                <BellRing className="size-4 text-faint" aria-hidden />
                <div>
                    <h2 className="section-title">Alerts</h2>
                    <p className="section-sub">{sub}</p>
                </div>
            </div>

            {alerts.length === 0 ? (
                <>
                    <p className="min-w-0 flex-1 text-[13px] text-faint">
                        {alertsEnabled
                            ? 'No alerts yet. Use the bell on any row, or “Set alert” on a stock page. We email you when it fires.'
                            : 'Email price alerts are part of OpenStock Cloud, $5 a month and coming soon.'}
                    </p>
                    {!alertsEnabled && <Link href="/#data" className="btn btn-ghost flex-none">See OpenStock Cloud</Link>}
                </>
            ) : (
                <>
                    <ul className="flex min-w-0 flex-1 flex-wrap gap-2">
                        {alerts.map((alert) => {
                            const status = statusOf(alert);
                            return (
                                <li key={alert._id} className="flex items-center gap-2.5 rounded-[10px] border border-white/10 py-1 pl-2.5 pr-1">
                                    <span className="mono font-semibold text-foreground">{alert.symbol}</span>
                                    <span className="num whitespace-nowrap text-[12.5px] text-faint">
                                        {alert.condition === 'ABOVE' ? 'Above' : 'Below'} {formatPrice(alert.targetPrice)}
                                        {alert.expiresAt && !alert.triggered && ` · until ${new Date(alert.expiresAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                                    </span>
                                    <span className={status.className}>{status.label}</span>
                                    <button
                                        type="button"
                                        onClick={() => handleDelete(alert)}
                                        disabled={pendingId === alert._id}
                                        className="icon-btn is-danger"
                                        title="Remove alert"
                                        aria-label={`Remove alert for ${alert.symbol}`}
                                    >
                                        <Trash2 />
                                    </button>
                                </li>
                            );
                        })}
                    </ul>
                    {!alertsEnabled && (
                        <p className="flex-none text-[12.5px] text-faint">
                            Alerts moved to <Link href="/#data" className="text-brand-ink hover:underline">OpenStock Cloud</Link>, so these are paused.
                        </p>
                    )}
                </>
            )}
        </div>
    );
}

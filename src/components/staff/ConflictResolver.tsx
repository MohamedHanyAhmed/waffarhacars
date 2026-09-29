"use client";

import React from "react";
import { useI18n } from "@/context/I18nContext";
import { AlertTriangle, RefreshCw, X } from "lucide-react";

export interface ConflictResolverProps {
  isOpen: boolean;
  serverVersion: number;
  expectedVersion?: number;
  currentVersion?: number;
  entityType?: string;
  clientValues?: Record<string, unknown>;
  serverValues?: Record<string, unknown>;
  conflicts?: Array<{ field: string; serverValue: string; localValue: string }>;
  onClose?: () => void;
  onCancel?: () => void;
  onAcceptServer?: () => void;
  onApplyServer?: () => void;
  onKeepLocalWithNewVersion?: () => void;
  onOverwrite?: () => void;
}

export function ConflictResolver({
  isOpen,
  serverVersion,
  expectedVersion,
  currentVersion,
  entityType: _entityType,
  clientValues,
  serverValues,
  conflicts,
  onClose,
  onCancel,
  onAcceptServer,
  onApplyServer,
  onKeepLocalWithNewVersion,
  onOverwrite,
}: ConflictResolverProps) {
  const { t, dir } = useI18n();

  if (!isOpen) return null;

  const effectiveExpectedVersion = expectedVersion ?? currentVersion ?? 1;
  const handleClose = onClose || onCancel || (() => {});
  const handleAccept = onAcceptServer || onApplyServer || (() => {});
  const handleKeep = onKeepLocalWithNewVersion || onOverwrite || (() => {});

  let resolvedConflicts = conflicts;
  if (!resolvedConflicts && clientValues && serverValues) {
    const keys = Array.from(new Set([...Object.keys(clientValues), ...Object.keys(serverValues)]));
    resolvedConflicts = keys
      .filter((k) => String(clientValues[k] ?? "") !== String(serverValues[k] ?? ""))
      .map((k) => ({
        field: k,
        localValue: String(clientValues[k] ?? ""),
        serverValue: String(serverValues[k] ?? ""),
      }));
  }
  const displayConflicts = resolvedConflicts || [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs"
      dir={dir}
      role="dialog"
      aria-modal="true"
      aria-labelledby="conflict-dialog-title"
    >
      <div className="bg-white rounded-2xl shadow-xl border border-amber-200 w-full max-w-lg overflow-hidden animate-in fade-in-50 zoom-in-95 duration-150">
        <div className="p-5 border-b border-amber-100 bg-amber-50/60 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 rounded-xl text-amber-800">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <h3 id="conflict-dialog-title" className="text-base font-bold text-amber-950">
                {t("onboarding.modals.conflictTitle")}
              </h3>
              <p className="text-xs text-amber-800 font-mono">
                Your version: v{effectiveExpectedVersion} • Latest server version: v{serverVersion}
              </p>
            </div>
          </div>

          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-amber-700 hover:text-amber-900 hover:bg-amber-100"
            aria-label={t("onboarding.modals.cancel")}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-xs text-slate-700 leading-relaxed">
            {t("onboarding.modals.conflictDesc")}
          </p>

          {displayConflicts.length > 0 && (
            <div className="rounded-xl border border-slate-200 overflow-hidden text-xs">
              <table className="w-full text-start">
                <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
                  <tr>
                    <th className="p-2 text-start">Field</th>
                    <th className="p-2 text-start">Server Value</th>
                    <th className="p-2 text-start">Your Local Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {displayConflicts.map((c) => (
                    <tr key={c.field}>
                      <td className="p-2 font-mono font-medium text-slate-900">{c.field}</td>
                      <td className="p-2 text-slate-600 bg-slate-50 font-mono">
                        {c.serverValue || "—"}
                      </td>
                      <td className="p-2 text-amber-800 bg-amber-50/60 font-semibold font-mono">
                        {c.localValue || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-end gap-2.5 pt-3 border-t border-slate-100">
            <button
              type="button"
              onClick={handleAccept}
              className="px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 border border-slate-200 rounded-lg transition-colors flex items-center justify-center gap-1.5"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              <span>{t("onboarding.modals.reloadRecord")}</span>
            </button>

            <button
              type="button"
              onClick={handleKeep}
              className="px-3.5 py-2 text-xs font-semibold text-white bg-amber-600 hover:bg-amber-700 rounded-lg transition-colors flex items-center justify-center gap-1.5 shadow-xs"
            >
              <span>{t("onboarding.modals.reapplyChanges")}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

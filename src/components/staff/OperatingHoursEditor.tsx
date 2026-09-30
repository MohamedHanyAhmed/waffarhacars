"use client";

import React from "react";
import { useI18n } from "@/context/I18nContext";
import type { OperatingHoursEntry } from "@/lib/provider/validation";

export interface OperatingHoursEditorProps {
  value: OperatingHoursEntry[];
  onChange: (hours: OperatingHoursEntry[]) => void;
  disabled?: boolean;
  readOnly?: boolean;
}

export const DEFAULT_WEEKLY_HOURS: OperatingHoursEntry[] = [
  { dayOfWeek: 0, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 1, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 2, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 3, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 4, openTime: "09:00", closeTime: "18:00", isClosed: false },
  { dayOfWeek: 5, openTime: "14:00", closeTime: "22:00", isClosed: true }, // Friday closed by default in Egypt
  { dayOfWeek: 6, openTime: "09:00", closeTime: "18:00", isClosed: false },
];

export function OperatingHoursEditor({
  value,
  onChange,
  disabled = false,
  readOnly = false,
}: OperatingHoursEditorProps) {
  const isDisabled = disabled || readOnly;
  const { t, dir } = useI18n();

  // Ensure full 7-day array
  const hoursMap = new Map(value.map((h) => [h.dayOfWeek, h]));
  const completeSchedule = [0, 1, 2, 3, 4, 5, 6].map((day) => {
    return (
      hoursMap.get(day) || {
        dayOfWeek: day,
        openTime: "09:00",
        closeTime: "18:00",
        isClosed: day === 5,
      }
    );
  });

  const handleUpdate = (day: number, updates: Partial<OperatingHoursEntry>) => {
    const updated = completeSchedule.map((entry) => {
      if (entry.dayOfWeek === day) {
        return { ...entry, ...updates };
      }
      return entry;
    });
    onChange(updated);
  };

  return (
    <div className="space-y-3" dir={dir}>
      <div className="overflow-x-auto rounded-xl border border-slate-200">
        <table className="w-full text-xs text-start">
          <thead className="bg-slate-100 text-slate-700 font-semibold border-b border-slate-200">
            <tr>
              <th className="py-2.5 px-3 text-start">{t("onboarding.branch.day")}</th>
              <th className="py-2.5 px-3 text-center">{t("onboarding.branch.closed")}</th>
              <th className="py-2.5 px-3 text-start">{t("onboarding.branch.openTime")}</th>
              <th className="py-2.5 px-3 text-start">{t("onboarding.branch.closeTime")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 bg-white">
            {completeSchedule.map((entry) => {
              const dayName = t(`onboarding.days.${entry.dayOfWeek}`);
              return (
                <tr key={entry.dayOfWeek} className={entry.isClosed ? "bg-slate-50/60" : ""}>
                  <td className="py-2.5 px-3 font-medium text-slate-800">{dayName}</td>
                  <td className="py-2.5 px-3 text-center">
                    <input
                      type="checkbox"
                      id={`day-closed-${entry.dayOfWeek}`}
                      aria-label={`${dayName} ${t("onboarding.branch.closed")}`}
                      checked={entry.isClosed}
                      disabled={isDisabled}
                      onChange={(e) =>
                        handleUpdate(entry.dayOfWeek, { isClosed: e.target.checked })
                      }
                      className="w-4 h-4 rounded text-brand-600 focus:ring-brand-500 border-slate-300"
                    />
                  </td>
                  <td className="py-2.5 px-3">
                    <input
                      type="time"
                      id={`day-open-${entry.dayOfWeek}`}
                      aria-label={`${dayName} ${t("onboarding.branch.openTime")}`}
                      value={entry.openTime}
                      disabled={isDisabled || entry.isClosed}
                      dir="ltr"
                      onChange={(e) => handleUpdate(entry.dayOfWeek, { openTime: e.target.value })}
                      className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg disabled:opacity-50 disabled:bg-slate-100 focus:ring-2 focus:ring-brand-500 font-mono"
                    />
                  </td>
                  <td className="py-2.5 px-3">
                    <input
                      type="time"
                      id={`day-close-${entry.dayOfWeek}`}
                      aria-label={`${dayName} ${t("onboarding.branch.closeTime")}`}
                      value={entry.closeTime}
                      disabled={isDisabled || entry.isClosed}
                      dir="ltr"
                      onChange={(e) => handleUpdate(entry.dayOfWeek, { closeTime: e.target.value })}
                      className="px-2.5 py-1 text-xs border border-slate-200 rounded-lg disabled:opacity-50 disabled:bg-slate-100 focus:ring-2 focus:ring-brand-500 font-mono"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

"use client";

import React, { useState } from "react";
import { useI18n } from "@/context/I18nContext";
import { MapPin, Navigation, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";

export interface GeolocationCaptureProps {
  latitude?: number | "";
  longitude?: number | "";
  onChange?: (coords: { latitude: number | ""; longitude: number | "" }) => void;
  onCoordinatesCaptured?: (lat: number, lng: number) => void;
  disabled?: boolean;
}

export function GeolocationCapture({
  latitude,
  longitude,
  onChange,
  onCoordinatesCaptured,
  disabled = false,
}: GeolocationCaptureProps) {
  const { t, dir } = useI18n();

  const [isLocating, setIsLocating] = useState(false);
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(
    null
  );

  const handleCapture = () => {
    if (!navigator.geolocation) {
      setFeedback({
        type: "error",
        message: t("onboarding.branch.locationDenied"),
      });
      return;
    }

    setIsLocating(true);
    setFeedback(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const rawLat = Number(position.coords.latitude.toFixed(6));
        const rawLng = Number(position.coords.longitude.toFixed(6));
        setIsLocating(false);
        onChange?.({ latitude: rawLat, longitude: rawLng });
        onCoordinatesCaptured?.(rawLat, rawLng);
        setFeedback({
          type: "success",
          message: `${t("onboarding.branch.locationCaptured")} (${rawLat}, ${rawLng})`,
        });
      },
      () => {
        setIsLocating(false);
        setFeedback({
          type: "error",
          message: t("onboarding.branch.locationDenied"),
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 0,
      }
    );
  };

  const isWithinCairo =
    typeof latitude === "number" &&
    typeof longitude === "number" &&
    latitude >= 29.75 &&
    latitude <= 30.35 &&
    longitude >= 31.05 &&
    longitude <= 31.75;

  return (
    <div className="space-y-3" dir={dir}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <label className="text-xs font-semibold text-slate-700 flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-brand-600" />
          <span>{t("onboarding.branch.coordinatesSection")}</span>
        </label>

        <button
          type="button"
          onClick={handleCapture}
          disabled={disabled || isLocating}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-brand-50 hover:bg-brand-100 text-brand-700 border border-brand-200 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500 disabled:opacity-50"
        >
          {isLocating ? (
            <>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              <span>{t("onboarding.branch.capturingLocation")}</span>
            </>
          ) : (
            <>
              <Navigation className="w-3.5 h-3.5" />
              <span>{t("onboarding.branch.captureLocation")}</span>
            </>
          )}
        </button>
      </div>

      {feedback && (
        <div
          role="status"
          className={`p-2.5 rounded-lg text-xs flex items-center gap-2 ${
            feedback.type === "success"
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200"
          }`}
        >
          {feedback.type === "success" ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
          )}
          <span>{feedback.message}</span>
        </div>
      )}

      {/* Manual Input Fallback */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label
            htmlFor="branch-latitude"
            className="block text-xs font-medium text-slate-600 mb-1"
          >
            {t("onboarding.branch.latLabel")}
          </label>
          <input
            id="branch-latitude"
            type="number"
            step="0.0001"
            value={latitude}
            disabled={disabled}
            placeholder={t("onboarding.branch.latPlaceholder")}
            dir="ltr"
            onChange={(e) => {
              const val = e.target.value === "" ? "" : Number(e.target.value);
              onChange?.({ latitude: val, longitude: longitude ?? "" });
              if (typeof val === "number" && typeof longitude === "number") {
                onCoordinatesCaptured?.(val, longitude);
              }
            }}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 font-mono disabled:bg-slate-100"
          />
        </div>

        <div>
          <label
            htmlFor="branch-longitude"
            className="block text-xs font-medium text-slate-600 mb-1"
          >
            {t("onboarding.branch.lngLabel")}
          </label>
          <input
            id="branch-longitude"
            type="number"
            step="0.0001"
            value={longitude}
            disabled={disabled}
            placeholder={t("onboarding.branch.lngPlaceholder")}
            dir="ltr"
            onChange={(e) => {
              const val = e.target.value === "" ? "" : Number(e.target.value);
              onChange?.({ latitude: latitude ?? "", longitude: val });
              if (typeof latitude === "number" && typeof val === "number") {
                onCoordinatesCaptured?.(latitude, val);
              }
            }}
            className="w-full px-3 py-2 text-xs border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-500 font-mono disabled:bg-slate-100"
          />
        </div>
      </div>

      {latitude !== "" && longitude !== "" && !isWithinCairo && (
        <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded-md border border-amber-200 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 text-amber-600" />
          <span>
            Coordinates appear to be outside the Greater Cairo pilot boundary (Lat: 29.75–30.35,
            Lng: 31.05–31.75).
          </span>
        </p>
      )}
    </div>
  );
}

"use client";

import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import {
  Reservation,
  CommissionAccrual,
  Vehicle,
  OfferVariant,
  OfferDraft,
  DemoScenarioMode,
  ProviderStatement,
} from "../domain/types";
import { DEMO_VEHICLES, PUBLISHED_OFFERS, SEED_OFFER_DRAFTS } from "../domain/fixtures";
import { LocalDemoRepository, LocalRepositorySerializableState } from "../domain/localRepository";
import { CheckInResult } from "../domain/stateTransitions";
import { CommitCompletionResult } from "../domain/repository";
import { StaticClock } from "../domain/clock";
import { DeterministicIdGenerator } from "../domain/idGenerator";

interface DemoStateContextType {
  selectedVehicle: Vehicle;
  setSelectedVehicle: (vehicle: Vehicle) => void;
  selectedArea: string;
  setSelectedArea: (area: string) => void;
  currentReservation: Reservation | null;
  commissionAccruals: CommissionAccrual[];
  publishedOffers: OfferVariant[];
  offerDrafts: OfferDraft[];
  activeScenario: DemoScenarioMode;
  setScenario: (mode: DemoScenarioMode) => Promise<void>;
  resetDemoState: () => Promise<void>;
  checkIn: (staffId?: string) => Promise<CheckInResult>;
  revealPin: () => Promise<{ success: boolean; error?: string }>;
  completeService: (inputPin: string) => Promise<CommitCompletionResult>;
  cancelReservation: () => Promise<void>;
  submitReview: (review: {
    rating: number;
    scopeHonored: boolean;
    priceHonored: boolean;
    comment: string;
  }) => Promise<{ success: boolean; error?: string }>;
  submitSalesDraft: (draft: Omit<OfferDraft, "id" | "status" | "createdAt">) => Promise<OfferDraft>;
  approveSalesDraft: (draftId: string) => Promise<{ success: boolean; error?: string }>;
  createNewReservation: (offer: OfferVariant) => Promise<Reservation>;
  providerStatement: ProviderStatement;
}

const STORAGE_KEY = "waffarhacars_demo_state_v5";

const DemoStateContext = createContext<DemoStateContextType | undefined>(undefined);

export function DemoStateProvider({ children }: { children: React.ReactNode }) {
  const [clock] = useState(() => new StaticClock("2026-09-13T12:00:00.000Z"));
  const [idGen] = useState(() => new DeterministicIdGenerator());
  const repoRef = useRef<LocalDemoRepository>(new LocalDemoRepository(clock, idGen));

  const [selectedVehicle, setSelectedVehicleState] = useState<Vehicle>(() => {
    if (typeof window !== "undefined") {
      try {
        const stored = localStorage.getItem("waffarha_demo_vehicle");
        if (stored) return JSON.parse(stored);
      } catch {}
    }
    return DEMO_VEHICLES.defaultSunny;
  });
  const [selectedArea, setSelectedArea] = useState<string>("Nasr City");
  const [currentReservation, setCurrentReservation] = useState<Reservation | null>(null);
  const [commissionAccruals, setCommissionAccruals] = useState<CommissionAccrual[]>([]);
  const [publishedOffers, setPublishedOffers] = useState<OfferVariant[]>(PUBLISHED_OFFERS);
  const [offerDrafts, setOfferDrafts] = useState<OfferDraft[]>(SEED_OFFER_DRAFTS);
  const [activeScenario, setActiveScenario] = useState<DemoScenarioMode>("clean_empty");
  const [providerStatement, setProviderStatement] = useState<ProviderStatement>({
    providerId: "prov-orbit-care",
    providerNameEn: "Orbit Auto Care",
    providerNameAr: "مركز أوربيت لصيانة السيارات",
    completedReservationsCount: 0,
    totalServiceVolume: { amountMinor: 0, currency: "EGP" },
    totalCommissionAccrued: { amountMinor: 0, currency: "EGP" },
    creditLimit: { amountMinor: 200000, currency: "EGP" },
    currentExposure: { amountMinor: 0, currency: "EGP" },
    isExposureHealthy: true,
    accruals: [],
  });

  const [isLoaded, setIsLoaded] = useState(false);

  // Sync state from repository instance
  const syncFromRepo = async () => {
    const repo = repoRef.current;
    const res = await repo.getActiveReservation();
    const accruals = await repo.getAccruals();
    const offers = await repo.getPublishedOffers();
    const drafts = await repo.getOfferDrafts();
    const stmt = await repo.getProviderStatement("prov-orbit-care");

    setCurrentReservation(res);
    setCommissionAccruals(accruals);
    setPublishedOffers(offers);
    setOfferDrafts(drafts);
    setProviderStatement(stmt);
    setActiveScenario(repo.getScenario());
  };

  // Load state from localStorage on mount (Hydration-safe)
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed: LocalRepositorySerializableState = JSON.parse(stored);
        repoRef.current = new LocalDemoRepository(clock, idGen, parsed);
      }
    } catch (e) {
      console.error("Failed to parse stored demo state:", e);
      // Clean fallback
      repoRef.current = new LocalDemoRepository(clock, idGen);
    } finally {
      syncFromRepo().then(() => setIsLoaded(true));
    }
  }, [clock, idGen]);

  // Save state on changes
  useEffect(() => {
    if (!isLoaded) return;
    try {
      const serialized = repoRef.current.getSerializableState();
      serialized.scenario = activeScenario;
      localStorage.setItem(STORAGE_KEY, JSON.stringify(serialized));
    } catch (e) {
      console.error("Failed to save demo state:", e);
    }
  }, [
    isLoaded,
    currentReservation,
    commissionAccruals,
    publishedOffers,
    offerDrafts,
    activeScenario,
  ]);

  const setSelectedVehicle = (veh: Vehicle) => {
    setSelectedVehicleState(veh);
    try {
      localStorage.setItem("waffarha_demo_vehicle", JSON.stringify(veh));
    } catch {}
  };

  const setScenario = async (mode: DemoScenarioMode) => {
    setActiveScenario(mode);
    if (mode === "incompatible_vehicle") {
      setSelectedVehicleState(DEMO_VEHICLES.incompatibleChery);
    } else {
      setSelectedVehicleState(DEMO_VEHICLES.defaultSunny);
    }
    await repoRef.current.selectScenario(mode);
    await syncFromRepo();
  };

  const resetDemoState = async () => {
    setSelectedVehicleState(DEMO_VEHICLES.defaultSunny);
    setSelectedArea("Nasr City");
    setActiveScenario("clean_empty");
    await repoRef.current.resetDemo();
    try {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem("waffarha_demo_vehicle");
    } catch (e) {
      console.error(e);
    }
    await syncFromRepo();
  };

  const checkIn = async (staffId: string = "staff-orbit-01"): Promise<CheckInResult> => {
    if (!currentReservation) {
      return {
        code: "PASS_NOT_FOUND",
        messageEn: "No active reservation found",
        messageAr: "لا يوجد حجز نشط",
      };
    }
    const res = await repoRef.current.checkInReservation(currentReservation.passCode, staffId);
    await syncFromRepo();
    return res;
  };

  const revealPin = async (): Promise<{ success: boolean; error?: string }> => {
    if (!currentReservation) return { success: false, error: "No active reservation" };
    const res = await repoRef.current.revealPin(currentReservation.passCode);
    await syncFromRepo();
    return res;
  };

  const completeService = async (inputPin: string): Promise<CommitCompletionResult> => {
    if (!currentReservation) {
      throw new Error("No active reservation to complete");
    }
    const res = await repoRef.current.completeReservation(
      currentReservation.passCode,
      inputPin,
      currentReservation.revision
    );
    await syncFromRepo();
    return res;
  };

  const cancelReservation = async () => {
    if (!currentReservation) return;
    await repoRef.current.cancelReservation(currentReservation.id);
    await syncFromRepo();
  };

  const submitReview = async (review: {
    rating: number;
    scopeHonored: boolean;
    priceHonored: boolean;
    comment: string;
  }) => {
    if (!currentReservation) return { success: false, error: "No active reservation" };
    try {
      await repoRef.current.submitVerifiedReview(currentReservation.id, {
        ...review,
        submittedAt: clock.now(),
      });
      await syncFromRepo();
      return { success: true };
    } catch (e: unknown) {
      const errorMsg = e instanceof Error ? e.message : "Failed to submit review";
      return { success: false, error: errorMsg };
    }
  };

  const submitSalesDraft = async (
    draft: Omit<OfferDraft, "id" | "status" | "createdAt">
  ): Promise<OfferDraft> => {
    const newDraft = await repoRef.current.submitOfferDraft(draft, {
      actorId: "sales-rep-cairo-01",
      role: "sales",
    });
    await syncFromRepo();
    return newDraft;
  };

  const approveSalesDraft = async (draftId: string) => {
    const res = await repoRef.current.approveOfferDraft(draftId, {
      actorId: "ops-manager-cairo",
      role: "operations",
    });
    await syncFromRepo();
    return res;
  };

  const createNewReservation = async (offer: OfferVariant): Promise<Reservation> => {
    const newRes = await repoRef.current.createReservation({
      offerId: offer.id,
      vehicle: selectedVehicle,
      customerName: "Tarek Mostafa (Demo Customer)",
      customerPhone: "+20 10 **** 5821",
      scheduledSlot: "Today, 3:30 PM (Nasr City)",
    });
    await syncFromRepo();
    return newRes;
  };

  return (
    <DemoStateContext.Provider
      value={{
        selectedVehicle,
        setSelectedVehicle,
        selectedArea,
        setSelectedArea,
        currentReservation,
        commissionAccruals,
        publishedOffers,
        offerDrafts,
        activeScenario,
        setScenario,
        resetDemoState,
        checkIn,
        revealPin,
        completeService,
        cancelReservation,
        submitReview,
        submitSalesDraft,
        approveSalesDraft,
        createNewReservation,
        providerStatement,
      }}
    >
      {children}
    </DemoStateContext.Provider>
  );
}

export function useDemoState(): DemoStateContextType {
  const context = useContext(DemoStateContext);
  if (!context) {
    throw new Error("useDemoState must be used within a DemoStateProvider");
  }
  return context;
}

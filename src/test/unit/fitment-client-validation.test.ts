import { createElement, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import FitmentCoverageEditor from "@/components/staff/FitmentCoverageEditor";
import { I18nProvider } from "@/context/I18nContext";
import {
  appendCatalogPage,
  loadVehicleCatalogPage,
  maximumCoveredYear,
  validateCoverageRows,
  validateEvidenceReference,
  validateRejectionReason,
  type CoverageRow,
} from "@/lib/fitment/client-validation";

const makeId = "10000000-0000-4000-8000-000000000001";
const modelId = "20000000-0000-4000-8000-000000000001";
const secondMake = "10000000-0000-4000-8000-000000000002";
const secondModel = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-06-01T00:00:00Z");
const row = { makeId, modelId, yearFrom: 2000, yearTo: 2026 };
const make = { id: makeId, code: "A", nameEn: "Make A", nameAr: "ماركة أ" };
const model = { id: modelId, makeId, code: "A", nameEn: "Model A", nameAr: "طراز أ" };

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
});

describe("client fitment input validation", () => {
  it("uses the Cairo calendar boundary for the maximum inclusive year", () => {
    expect(maximumCoveredYear(new Date("2026-12-31T22:30:00Z"))).toBe(2028);
    expect(validateCoverageRows([{ ...row, yearTo: 2027 }], now)).toBeNull();
    expect(validateCoverageRows([{ ...row, yearTo: 2028 }], now)).toBe(
      "capabilities.coverage.invalid"
    );
  });

  it("rejects missing identity, noninteger/reversed years, empty and oversized range lists", () => {
    for (const rows of [
      [],
      Array.from({ length: 51 }, () => row),
      [{ ...row, makeId: "Make A" }],
      [{ ...row, modelId: "" }],
      [{ ...row, yearFrom: 1899 }],
      [{ ...row, yearFrom: 2000.5 }],
      [{ ...row, yearTo: Number.NaN }],
      [{ ...row, yearFrom: 2027, yearTo: 2026 }],
    ]) {
      expect(validateCoverageRows(rows, now)).toBe("capabilities.coverage.invalid");
    }
  });

  it("rejects duplicate and inclusive overlapping coverage without mutating caller order", () => {
    expect(validateCoverageRows([row, { ...row }], now)).toBe("capabilities.coverage.overlap");
    const entries = [
      { ...row, yearFrom: 2020 },
      { ...row, yearTo: 2020 },
    ];
    expect(validateCoverageRows(entries, now)).toBe("capabilities.coverage.overlap");
    expect(entries[0].yearFrom).toBe(2020);
    expect(
      validateCoverageRows(
        [
          { ...row, yearTo: 2019 },
          { ...row, yearFrom: 2020 },
        ],
        now
      )
    ).toBeNull();
    expect(validateCoverageRows([row, { ...row, makeId: secondMake }], now)).toBe(
      "capabilities.coverage.invalid"
    );
  });

  it("mirrors opaque evidence and bounded private-reason constraints", () => {
    expect(validateEvidenceReference("  EVIDENCE_2026:packet-4.1  ")).toBeNull();
    for (const value of [
      "ab",
      "x".repeat(129),
      "https://example.com",
      "packet with spaces",
      "دليل",
    ]) {
      expect(validateEvidenceReference(value)).toBe("capabilities.validation.evidence");
    }
    expect(validateRejectionReason("  يلزم توضيح نطاق السنوات  ")).toBeNull();
    for (const value of [
      "ab",
      "x".repeat(1001),
      "See https://example.com",
      "mail a@b.com",
      "Call +201001234567",
    ]) {
      expect(validateRejectionReason(value)).toBe("capabilities.validation.reason");
    }
  });
});

describe("canonical catalogue pagination", () => {
  it("passes the returned cursor and make identity to subsequent model reads", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ items: [model], nextCursor: modelId }))
      .mockResolvedValueOnce(
        Response.json({ items: [{ ...model, id: secondModel }], nextCursor: null })
      );
    const signal = new AbortController().signal;
    const first = await loadVehicleCatalogPage({ makeId }, signal, transport);
    const second = await loadVehicleCatalogPage(
      { makeId, cursor: first.nextCursor! },
      signal,
      transport
    );
    expect(transport.mock.calls[1][0]).toBe(
      `/api/v1/vehicles/catalog?limit=30&makeId=${makeId}&cursor=${modelId}`
    );
    expect(transport.mock.calls[1][1]).toMatchObject({
      cache: "no-store",
      credentials: "same-origin",
      signal: expect.any(AbortSignal),
    });
    expect(appendCatalogPage(first.items, [...second.items, model]).map((item) => item.id)).toEqual(
      [modelId, secondModel]
    );
  });

  it("refuses cross-make rows, malformed responses and repeated cursors", async () => {
    for (const payload of [
      { items: [{ ...model, makeId: secondMake }], nextCursor: null },
      { items: [model], nextCursor: modelId },
      { items: [{ id: "not canonical" }], nextCursor: null },
    ]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
      await expect(
        loadVehicleCatalogPage({ makeId, cursor: modelId }, new AbortController().signal, transport)
      ).rejects.toThrow("CATALOG_UNAVAILABLE");
    }
  });

  it("bounds a hung catalogue request without aborting its caller scope", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const transport = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("CATALOG_TIMEOUT")), {
            once: true,
          });
        })
    );
    const result = loadVehicleCatalogPage({}, caller.signal, transport);
    const assertion = expect(result).rejects.toThrow("CATALOG_TIMEOUT");
    await vi.advanceTimersByTimeAsync(12_000);
    await assertion;
    expect(caller.signal.aborted).toBe(false);
  });

  it("renders subsequent make/model choices and clears model identity when the make changes", async () => {
    const transport = vi.fn<typeof fetch>(async (url) => {
      const params = new URL(String(url), "http://localhost").searchParams;
      if (params.get("makeId") === secondMake)
        return Response.json({ items: [], nextCursor: null });
      if (params.has("makeId"))
        return Response.json(
          params.has("cursor")
            ? { items: [{ ...model, id: secondModel, nameEn: "Model B" }], nextCursor: null }
            : { items: [model], nextCursor: modelId }
        );
      return Response.json(
        params.has("cursor")
          ? { items: [{ ...make, id: secondMake, nameEn: "Make B" }], nextCursor: null }
          : { items: [make], nextCursor: makeId }
      );
    });
    vi.stubGlobal("fetch", transport);
    function Harness() {
      const [value, onChange] = useState<CoverageRow[]>([row]);
      return createElement(
        I18nProvider,
        null,
        createElement(FitmentCoverageEditor, { value, onChange })
      );
    }
    render(createElement(Harness));
    await screen.findByTestId("fitment-more-makes");
    fireEvent.click(screen.getByTestId("fitment-more-makes"));
    await screen.findByRole("option", { name: "Make B" });
    fireEvent.click(await screen.findByTestId("fitment-more-models-0"));
    await screen.findByRole("option", { name: "Model B" });
    fireEvent.change(document.getElementById("fitment-make-0")!, { target: { value: secondMake } });
    expect((document.getElementById("fitment-model-0") as HTMLSelectElement).value).toBe("");
    await waitFor(() =>
      expect(
        transport.mock.calls.some(([url]) => String(url).includes(`makeId=${secondMake}`))
      ).toBe(true)
    );
  });

  it("ignores a late catalogue response for a make that was replaced", async () => {
    let completeFirst!: (response: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url) => {
        const params = new URL(String(url), "http://localhost").searchParams;
        if (params.get("makeId") === makeId)
          return new Promise<Response>((resolve) => {
            completeFirst = resolve;
          });
        if (params.get("makeId") === secondMake)
          return Response.json({
            items: [{ ...model, id: secondModel, makeId: secondMake, nameEn: "Current model" }],
            nextCursor: null,
          });
        return Response.json({
          items: [make, { ...make, id: secondMake, nameEn: "Make B" }],
          nextCursor: null,
        });
      })
    );
    const renderEditor = (rows: CoverageRow[]) =>
      createElement(
        I18nProvider,
        null,
        createElement(FitmentCoverageEditor, { value: rows, onChange: () => {} })
      );
    const view = render(renderEditor([row]));
    await screen.findByRole("option", { name: "Make B" });
    view.rerender(renderEditor([{ ...row, makeId: secondMake, modelId: "" }]));
    await screen.findByRole("option", { name: "Current model" });
    await act(async () =>
      completeFirst(Response.json({ items: [{ ...model, nameEn: "Old model" }], nextCursor: null }))
    );
    expect(screen.queryByRole("option", { name: "Old model" })).toBeNull();
    expect(screen.getByRole("option", { name: "Current model" })).not.toBeNull();
  });

  it("keeps saved inactive canonical identity and labels visible when absent from active pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ items: [], nextCursor: null }))
    );
    render(
      createElement(
        I18nProvider,
        null,
        createElement(FitmentCoverageEditor, {
          value: [row],
          onChange: () => {},
          savedCoverage: [
            {
              ...row,
              makeNameEn: "Saved make",
              makeNameAr: "ماركة",
              modelNameEn: "Saved model",
              modelNameAr: "طراز",
              makeIsActive: false,
              modelIsActive: false,
            },
          ],
        })
      )
    );
    await screen.findByRole("option", { name: /Saved make/ });
    expect(
      (screen.getByRole("option", { name: /Saved model/ }) as HTMLOptionElement).disabled
    ).toBe(true);
    expect((document.getElementById("fitment-model-0") as HTMLSelectElement).value).toBe(modelId);
  });

  it("disables a cached selected catalogue option when a refreshed saved snapshot marks it inactive", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async (url) =>
        Response.json({
          items: String(url).includes("makeId=") ? [model] : [make],
          nextCursor: null,
        })
      )
    );
    const editor = (active: boolean) =>
      createElement(
        I18nProvider,
        null,
        createElement(FitmentCoverageEditor, {
          value: [row],
          onChange: () => {},
          savedCoverage: [
            {
              ...row,
              makeNameEn: make.nameEn,
              makeNameAr: make.nameAr,
              modelNameEn: model.nameEn,
              modelNameAr: model.nameAr,
              makeIsActive: active,
              modelIsActive: active,
            },
          ],
        })
      );
    const view = render(editor(true));
    await screen.findByRole("option", { name: "Model A" });
    expect((screen.getByRole("option", { name: "Model A" }) as HTMLOptionElement).disabled).toBe(
      false
    );
    view.rerender(editor(false));
    expect((screen.getByRole("option", { name: /Model A/ }) as HTMLOptionElement).disabled).toBe(
      true
    );
    expect((screen.getByRole("option", { name: /Make A/ }) as HTMLOptionElement).disabled).toBe(
      true
    );
    expect((document.getElementById("fitment-model-0") as HTMLSelectElement).value).toBe(modelId);
  });
});

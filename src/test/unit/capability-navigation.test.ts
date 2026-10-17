import { createElement, StrictMode } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CapabilityNavigationBoundary, {
  protectCapabilityNavigation,
} from "@/components/staff/CapabilityNavigationBoundary";

afterEach(cleanup);

describe("capability navigation boundary lease (client isolation)", () => {
  it("intercepts only with an active lease and permits later listeners after release", () => {
    render(createElement(CapabilityNavigationBoundary));
    const later = vi.fn();
    const guard = vi.fn((event: PopStateEvent) => event.stopImmediatePropagation());
    const release = protectCapabilityNavigation(guard);
    window.addEventListener("popstate", later);
    try {
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(guard).toHaveBeenCalledTimes(1);
      expect(later).not.toHaveBeenCalled();
      release();
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(guard).toHaveBeenCalledTimes(1);
      expect(later).toHaveBeenCalledTimes(1);
    } finally {
      release();
      window.removeEventListener("popstate", later);
    }
  });

  it("does not let an older workspace cleanup release a newer workspace lease", () => {
    render(createElement(CapabilityNavigationBoundary));
    const older = vi.fn();
    const newer = vi.fn();
    const releaseOld = protectCapabilityNavigation(older);
    const releaseNew = protectCapabilityNavigation(newer);
    try {
      releaseOld();
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(older).not.toHaveBeenCalled();
      expect(newer).toHaveBeenCalledTimes(1);
    } finally {
      releaseNew();
    }
  });

  it("removes its sole listener after strict-mode lifecycle cleanup", () => {
    const view = render(
      createElement(StrictMode, null, createElement(CapabilityNavigationBoundary))
    );
    const guard = vi.fn();
    const release = protectCapabilityNavigation(guard);
    try {
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(guard).toHaveBeenCalledTimes(1);
      view.unmount();
      window.dispatchEvent(new PopStateEvent("popstate"));
      expect(guard).toHaveBeenCalledTimes(1);
    } finally {
      release();
    }
  });
});

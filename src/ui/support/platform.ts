import type { TalqynTheme } from '../theme.js';

/**
 * Whether the shopper asked the system for less movement. Animations then go without travel; the change
 * still happens.
 */
export function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Whether the main pointer is a mouse or a trackpad: where Enter sends a question and hover can reveal. */
export function hasFinePointer(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(hover: hover) and (pointer: fine)').matches;
}

/** A light knock for taps that mean something — a chip picked, a question sent — where the device vibrates and the theme allows it. */
export function tapFeedback(theme: TalqynTheme): void {
  if (!theme.hapticsEnabled || typeof navigator === 'undefined') return;
  try {
    navigator.vibrate?.(8);
  } catch {
    // A browser that refuses is a browser without the knock.
  }
}

/**
 * Puts text on the clipboard.
 *
 * The Clipboard API wants a secure context and a focused document; where it refuses, a hidden text area
 * and `execCommand('copy')` still work in every browser.
 */
export async function copyText(text: string, within: Node): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to the old way.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    area.style.pointerEvents = 'none';
    const root = within.getRootNode();
    const host = root instanceof ShadowRoot ? root : document.body;
    host.appendChild(area);
    area.select();
    const copied = document.execCommand('copy');
    area.remove();
    return copied;
  } catch {
    return false;
  }
}

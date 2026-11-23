import { act } from 'react';

/**
 * Picks `day` in a DatePicker (date-picker.tsx) as a person does, for tests:
 * opens it from its button, moves month by month to the day's, and clicks
 * the day; null clicks Clear. Tests only.
 */
export async function pickDate(trigger: HTMLElement, day: string | null): Promise<void> {
  await act(async () => trigger.click());
  if (day === null) {
    await act(async () =>
      document.querySelector<HTMLButtonElement>('[data-action="datePicker.clear"]')!.click(),
    );
    return;
  }
  const target = day.slice(0, 7);
  for (let i = 0; i < 1200; i += 1) {
    const shown = document
      .querySelectorAll<HTMLElement>('[data-day]')[15]
      ?.dataset.day?.slice(0, 7);
    if (!shown || shown === target) break;
    const step = target < shown ? 'previousMonth' : 'nextMonth';
    await act(async () =>
      document.querySelector<HTMLButtonElement>(`[data-action="datePicker.${step}"]`)!.click(),
    );
  }
  await act(async () => document.querySelector<HTMLButtonElement>(`[data-day="${day}"]`)!.click());
}

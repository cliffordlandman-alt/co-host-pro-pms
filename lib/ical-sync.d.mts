export type IcalEvent = { uid: string; summary: string; dtstart: string; dtend: string; code: string | null; blocked: boolean };
export type IcalFlag = { type: string; reservationId?: number; message: string };
export function parseIcalDate(value: string): string | null;
export function parseIcalEvents(raw: string): IcalEvent[];
export function guestLabel(platform: string, event: IcalEvent): string;
export function planIcalSync(input: { platform: string; events: IcalEvent[]; existing: any[]; today: string }): {
  inserts: Array<Record<string, any> & { flag?: IcalFlag }>;
  updates: Array<{ id: number; patch: Record<string, any>; previous: { checkIn: string; checkOut: string }; released?: boolean }>;
  flags: IcalFlag[];
  unchanged: number;
};

export type Weekday = 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'sun';

export type TimeRange = { from: string; to: string };

export type WorkDay = TimeRange & { breaks: TimeRange[] };

export type Master = {
  id: string;
  name: string;
  schedule: Record<Weekday, WorkDay | null>;
};

export type Service = {
  id: string;
  name: string;
  durationMin: number;
  masterIds: string[];
};

export type Booking = {
  id: string;
  masterId: string;
  serviceId: string;
  start: string;
  end: string;
  clientPhone: string;
  status: 'active' | 'cancelled';
};

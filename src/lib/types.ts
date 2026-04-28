export type UserRole = "admin" | "gestor" | "limpieza" | "mantenimiento";

export type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: UserRole;
  whatsapp: string | null;
  created_at: string;
};

export type Property = {
  id: string;
  name: string;
  airbnb_ical_url: string | null;
  booking_ical_url: string | null;
  created_at: string;
};

export type ReservationSource = "airbnb" | "booking" | "manual";

export type Reservation = {
  id: string;
  property_id: string;
  guest_name: string | null;
  guest_phone: string | null;
  check_in: string;
  check_out: string;
  source: ReservationSource;
  external_id: string | null;
  notes: string | null;
  created_at: string;
};

export type TaskStatus = "pending" | "in_progress" | "done";
export type TaskKind = "limpieza" | "mantenimiento" | "insumos" | "otro";

export type Task = {
  id: string;
  property_id: string;
  kind: TaskKind;
  status: TaskStatus;
  title: string;
  description: string | null;
  assigned_to: string | null;
  reported_by: string | null;
  due_date: string | null;
  created_at: string;
};

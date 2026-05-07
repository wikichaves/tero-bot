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
  currency: string;
  tariff_per_kwh: number | null;
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

export type LockPasswordStatus = "active" | "revoked" | "expired";

export type LockPassword = {
  id: string;
  property_device_id: string;
  reservation_id: string | null;
  name: string;
  password: string;
  tuya_password_id: string;
  effective_time: string;
  invalid_time: string;
  status: LockPasswordStatus;
  created_by: string | null;
  created_at: string;
};

export type WhatsAppAudience = "guest" | "staff" | "unknown";
export type WhatsAppDirection = "inbound" | "outbound";

export type WhatsAppConversation = {
  id: string;
  phone_number: string;
  display_name: string | null;
  audience: WhatsAppAudience;
  profile_id: string | null;
  last_message_at: string | null;
  last_message_text: string | null;
  last_message_direction: WhatsAppDirection | null;
  unread_count: number;
  created_at: string;
  updated_at: string;
};

export type DeviceKind =
  | "lock"
  | "thermostat"
  | "light"
  | "switch"
  | "camera"
  | "other";

export type PropertyDevice = {
  id: string;
  property_id: string;
  tuya_device_id: string;
  tuya_device_name: string | null;
  device_kind: DeviceKind;
  is_primary: boolean;
  created_at: string;
};

export type WhatsAppMessage = {
  id: string;
  conversation_id: string;
  external_id: string | null;
  direction: WhatsAppDirection;
  type: string;
  body: string | null;
  media_url: string | null;
  template_name: string | null;
  status: string | null;
  sent_at: string;
};

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
  /** Numeric Airbnb listing id (e.g. "1526467") used to match inbound
   *  confirmation emails to a property. Optional. */
  airbnb_listing_id: string | null;
  created_at: string;
};

export type ReservationSource = "airbnb" | "booking" | "manual";
export type ReservationStatus = "confirmed" | "cancelled" | "altered";

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
  /** Airbnb HM code (parsed from iCal DESCRIPTION or confirmation email). */
  reservation_code: string | null;
  guest_count: number | null;
  payout_amount: number | null;
  /** ISO 4217 (e.g. UYU, USD, ARS). */
  payout_currency: string | null;
  /** Free-form note from the guest, extracted from the confirmation email. */
  guest_message: string | null;
  /** Guest's Airbnb profile photo URL (muscache.com CDN). */
  guest_photo_url: string | null;
  /** True if Airbnb showed "Identity Verified" next to the guest profile. */
  guest_identity_verified: boolean | null;
  /** Free-form location string from the guest profile (e.g. "Madrid, España"). */
  guest_location: string | null;
  /** Adult / child / infant breakdown when available. `guest_count` stays as
   *  the total for backwards compat. */
  guest_adults: number | null;
  guest_children: number | null;
  guest_infants: number | null;
  /** "HH:MM" 24h. Default comes from the Airbnb email; admin can override. */
  check_in_time: string | null;
  check_out_time: string | null;
  status: ReservationStatus;
};

/** Persisted raw + parsed payload of an inbound Airbnb email. */
export type AirbnbInboundEmail = {
  id: string;
  message_id: string | null;
  reservation_id: string | null;
  parsed_kind:
    | "confirmation"
    | "cancellation"
    | "modification"
    | "unknown"
    | null;
  parsed: unknown;
  raw: unknown;
  received_at: string;
};

/** Output of `parseAirbnbEmail()`. Discriminated by `kind`. */
export type ParsedAirbnbEmail =
  | {
      kind: "confirmation" | "modification";
      reservation_code: string;
      guest_first_name: string | null;
      guest_count: number | null;
      guest_adults: number | null;
      guest_children: number | null;
      guest_infants: number | null;
      guest_identity_verified: boolean | null;
      guest_location: string | null;
      payout_amount: number | null;
      payout_currency: string | null;
      guest_message: string | null;
      check_in: string | null;
      check_out: string | null;
      check_in_time: string | null;
      check_out_time: string | null;
      listing_name: string | null;
      /** Numeric Airbnb listing id pulled from `/rooms/<id>` URLs in the
       *  email. More stable for matching than the listing's display name. */
      airbnb_listing_id: string | null;
      /** Guest profile photo URL from muscache.com CDN. */
      guest_photo_url: string | null;
      locale: "es" | "en";
    }
  | {
      kind: "cancellation";
      reservation_code: string;
      listing_name: string | null;
      airbnb_listing_id: string | null;
      locale: "es" | "en";
    }
  | {
      kind: "unknown";
      reason: string;
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

export type EnergySnapshot = {
  id: string;
  property_device_id: string;
  power_w: number | null;
  total_energy_kwh: number | null;
  voltage_v: number | null;
  current_a: number | null;
  taken_at: string;
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

/** The computed facts, exactly the fields of state.facts in docs/examples. */
export interface Facts {
  device_age_minutes: number | null;
  hours_since_password_reset: number | null;
  hours_since_mfa_change: number | null;
  anonymizer: string | null;
  country_seen_in_successful_logins: boolean | null;
  failed_logins_1h_before: number | null;
  login_hour_local: number | null;
  hour_seen_in_successful_logins: boolean | null;
  seconds_login_to_transfer: number | null;
  successful_logins_in_history: number | null;
  thin_history: boolean | null;
}

/** The parts of the risk request the facts read; everything optional, nothing is trusted. */
export interface FactsRequest {
  transaction?: { requested_at?: string | null } | null;
  customer?: { timezone?: string | null } | null;
  session?: {
    authenticated_at?: string | null;
    device_first_seen_at?: string | null;
    last_password_reset_at?: string | null;
    last_mfa_change_at?: string | null;
    network?: { anonymizer?: string | null; ip_country?: string | null } | null;
  } | null;
  history?: {
    recent_login_attempts?:
      | {
          occurred_at?: string | null;
          outcome?: string | null;
          network?: { ip_country?: string | null } | null;
        }[]
      | null;
  } | null;
}

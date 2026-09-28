/** The server-managed onboarding flow: questions, answers, the saved config
 *  and a user's response, plus the events that deliver them. */

/** One answer chip on an onboarding question. */
export interface OnboardingAnswer {
  id: string;
  label: string;
  /** Channels added to the user's visible-channel set when selected. */
  channel_ids: number[];
  /** Mumble ACL group names the user is added to on selection. */
  group_names: string[];
  emoji?: string | null;
  description?: string | null;
}

/** One multiple-choice question of the onboarding flow. */
export interface OnboardingQuestion {
  id: string;
  text: string;
  multi_select: boolean;
  required: boolean;
  /** True when the question must be answered before fully entering the server. */
  ask_before_join: boolean;
  answers: OnboardingAnswer[];
}

/** Server-managed onboarding configuration. */
export interface OnboardingConfig {
  version: number;
  enabled: boolean;
  default_channel_ids: number[];
  questions: OnboardingQuestion[];
  /** Monotonic revision number; bumped by the server on every admin update. */
  revision: number;
  updated_by?: string | null;
  updated_at?: number | null;
}

/** A user's selected answer ids for one question. */
export interface OnboardingSelection {
  question_id: string;
  /** One id for single-select; multiple for multi-select. */
  answer_ids: string[];
}

/** A user's onboarding response. */
export interface OnboardingResponse {
  user_hash?: string | null;
  submitted_at?: number | null;
  config_revision: number;
  selections: OnboardingSelection[];
}

/** Event payload emitted by the backend when a new onboarding config arrives. */
export interface OnboardingConfigEvent {
  config: OnboardingConfig;
  serverId?: string | null;
}

/** Event payload emitted when the user's stored onboarding response is delivered. */
export interface OnboardingResponseEvent {
  response: OnboardingResponse | null;
  serverId?: string | null;
}

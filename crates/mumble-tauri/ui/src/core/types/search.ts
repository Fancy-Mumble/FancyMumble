/** Super-search results and the photo-gallery entries it surfaces. */

export type SearchCategory = "channel" | "user" | "message";

export interface SearchResult {
  category: SearchCategory;
  score: number;
  title: string;
  subtitle: string | null;
  id: number | null;
  string_id: string | null;
}

export interface PhotoEntry {
  src: string;
  sender_name: string;
  channel_id?: number | null;
  dm_session?: number | null;
  context: string;
  timestamp?: number | null;
}

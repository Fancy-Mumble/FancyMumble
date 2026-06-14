/**
 * Windows/Outlook-style time-zone list for the meeting time-zone selector.
 *
 * Each entry pairs a representative IANA zone `id` (what we store) with the
 * familiar `(UTC±HH:MM) City, City, …` display `label`. Labels are static
 * (canonical Windows display names); the actual UTC offset of a zone still
 * varies with DST at runtime, but the label is what users recognise.
 */

export interface TimezoneEntry {
  /** Representative IANA zone id (stored on the event). */
  readonly id: string;
  /** Windows-style display label. */
  readonly label: string;
}

export const TIMEZONES: readonly TimezoneEntry[] = [
  { id: "Etc/GMT+12", label: "(UTC-12:00) International Date Line West" },
  { id: "Etc/GMT+11", label: "(UTC-11:00) Coordinated Universal Time-11" },
  { id: "America/Adak", label: "(UTC-10:00) Aleutian Islands" },
  { id: "Pacific/Honolulu", label: "(UTC-10:00) Hawaii" },
  { id: "Pacific/Marquesas", label: "(UTC-09:30) Marquesas Islands" },
  { id: "America/Anchorage", label: "(UTC-09:00) Alaska" },
  { id: "Etc/GMT+9", label: "(UTC-09:00) Coordinated Universal Time-09" },
  { id: "America/Tijuana", label: "(UTC-08:00) Baja California" },
  { id: "Etc/GMT+8", label: "(UTC-08:00) Coordinated Universal Time-08" },
  { id: "America/Los_Angeles", label: "(UTC-08:00) Pacific Time (US & Canada)" },
  { id: "America/Phoenix", label: "(UTC-07:00) Arizona" },
  { id: "America/Chihuahua", label: "(UTC-07:00) Chihuahua, La Paz, Mazatlan" },
  { id: "America/Denver", label: "(UTC-07:00) Mountain Time (US & Canada)" },
  { id: "America/Guatemala", label: "(UTC-06:00) Central America" },
  { id: "America/Chicago", label: "(UTC-06:00) Central Time (US & Canada)" },
  { id: "Pacific/Easter", label: "(UTC-06:00) Easter Island" },
  { id: "America/Mexico_City", label: "(UTC-06:00) Guadalajara, Mexico City, Monterrey" },
  { id: "America/Regina", label: "(UTC-06:00) Saskatchewan" },
  { id: "America/Bogota", label: "(UTC-05:00) Bogota, Lima, Quito, Rio Branco" },
  { id: "America/Cancun", label: "(UTC-05:00) Chetumal" },
  { id: "America/New_York", label: "(UTC-05:00) Eastern Time (US & Canada)" },
  { id: "America/Port-au-Prince", label: "(UTC-05:00) Haiti" },
  { id: "America/Havana", label: "(UTC-05:00) Havana" },
  { id: "America/Indiana/Indianapolis", label: "(UTC-05:00) Indiana (East)" },
  { id: "America/Grand_Turk", label: "(UTC-05:00) Turks and Caicos" },
  { id: "America/Asuncion", label: "(UTC-04:00) Asuncion" },
  { id: "America/Halifax", label: "(UTC-04:00) Atlantic Time (Canada)" },
  { id: "America/Caracas", label: "(UTC-04:00) Caracas" },
  { id: "America/Cuiaba", label: "(UTC-04:00) Cuiaba" },
  { id: "America/La_Paz", label: "(UTC-04:00) Georgetown, La Paz, Manaus, San Juan" },
  { id: "America/Santiago", label: "(UTC-04:00) Santiago" },
  { id: "America/St_Johns", label: "(UTC-03:30) Newfoundland" },
  { id: "America/Araguaina", label: "(UTC-03:00) Araguaina" },
  { id: "America/Sao_Paulo", label: "(UTC-03:00) Brasilia" },
  { id: "America/Cayenne", label: "(UTC-03:00) Cayenne, Fortaleza" },
  { id: "America/Argentina/Buenos_Aires", label: "(UTC-03:00) City of Buenos Aires" },
  { id: "America/Godthab", label: "(UTC-03:00) Greenland" },
  { id: "America/Montevideo", label: "(UTC-03:00) Montevideo" },
  { id: "America/Miquelon", label: "(UTC-03:00) Saint Pierre and Miquelon" },
  { id: "America/Bahia", label: "(UTC-03:00) Salvador" },
  { id: "Etc/GMT+2", label: "(UTC-02:00) Coordinated Universal Time-02" },
  { id: "Atlantic/Azores", label: "(UTC-01:00) Azores" },
  { id: "Atlantic/Cape_Verde", label: "(UTC-01:00) Cabo Verde Is." },
  { id: "Etc/UTC", label: "(UTC) Coordinated Universal Time" },
  { id: "Europe/London", label: "(UTC+00:00) Dublin, Edinburgh, Lisbon, London" },
  { id: "Atlantic/Reykjavik", label: "(UTC+00:00) Monrovia, Reykjavik" },
  { id: "Africa/Casablanca", label: "(UTC+01:00) Casablanca" },
  { id: "Europe/Berlin", label: "(UTC+01:00) Amsterdam, Berlin, Bern, Rome, Stockholm, Vienna" },
  { id: "Europe/Belgrade", label: "(UTC+01:00) Belgrade, Bratislava, Budapest, Ljubljana, Prague" },
  { id: "Europe/Paris", label: "(UTC+01:00) Brussels, Copenhagen, Madrid, Paris" },
  { id: "Europe/Warsaw", label: "(UTC+01:00) Sarajevo, Skopje, Warsaw, Zagreb" },
  { id: "Africa/Lagos", label: "(UTC+01:00) West Central Africa" },
  { id: "Europe/Bucharest", label: "(UTC+02:00) Athens, Bucharest" },
  { id: "Asia/Beirut", label: "(UTC+02:00) Beirut" },
  { id: "Africa/Cairo", label: "(UTC+02:00) Cairo" },
  { id: "Europe/Chisinau", label: "(UTC+02:00) Chisinau" },
  { id: "Asia/Damascus", label: "(UTC+02:00) Damascus" },
  { id: "Asia/Hebron", label: "(UTC+02:00) Gaza, Hebron" },
  { id: "Africa/Johannesburg", label: "(UTC+02:00) Harare, Pretoria" },
  { id: "Europe/Kiev", label: "(UTC+02:00) Helsinki, Kyiv, Riga, Sofia, Tallinn, Vilnius" },
  { id: "Asia/Jerusalem", label: "(UTC+02:00) Jerusalem" },
  { id: "Europe/Kaliningrad", label: "(UTC+02:00) Kaliningrad" },
  { id: "Africa/Tripoli", label: "(UTC+02:00) Tripoli" },
  { id: "Africa/Windhoek", label: "(UTC+02:00) Windhoek" },
  { id: "Asia/Amman", label: "(UTC+03:00) Amman" },
  { id: "Asia/Baghdad", label: "(UTC+03:00) Baghdad" },
  { id: "Europe/Istanbul", label: "(UTC+03:00) Istanbul" },
  { id: "Asia/Riyadh", label: "(UTC+03:00) Kuwait, Riyadh" },
  { id: "Europe/Minsk", label: "(UTC+03:00) Minsk" },
  { id: "Europe/Moscow", label: "(UTC+03:00) Moscow, St. Petersburg" },
  { id: "Africa/Nairobi", label: "(UTC+03:00) Nairobi" },
  { id: "Asia/Tehran", label: "(UTC+03:30) Tehran" },
  { id: "Asia/Dubai", label: "(UTC+04:00) Abu Dhabi, Muscat" },
  { id: "Europe/Astrakhan", label: "(UTC+04:00) Astrakhan, Ulyanovsk" },
  { id: "Asia/Baku", label: "(UTC+04:00) Baku" },
  { id: "Europe/Samara", label: "(UTC+04:00) Izhevsk, Samara" },
  { id: "Indian/Mauritius", label: "(UTC+04:00) Port Louis" },
  { id: "Asia/Tbilisi", label: "(UTC+04:00) Tbilisi" },
  { id: "Asia/Yerevan", label: "(UTC+04:00) Yerevan" },
  { id: "Asia/Kabul", label: "(UTC+04:30) Kabul" },
  { id: "Asia/Tashkent", label: "(UTC+05:00) Ashgabat, Tashkent" },
  { id: "Asia/Yekaterinburg", label: "(UTC+05:00) Ekaterinburg" },
  { id: "Asia/Karachi", label: "(UTC+05:00) Islamabad, Karachi" },
  { id: "Asia/Kolkata", label: "(UTC+05:30) Chennai, Kolkata, Mumbai, New Delhi" },
  { id: "Asia/Colombo", label: "(UTC+05:30) Sri Jayawardenepura" },
  { id: "Asia/Kathmandu", label: "(UTC+05:45) Kathmandu" },
  { id: "Asia/Almaty", label: "(UTC+06:00) Astana" },
  { id: "Asia/Dhaka", label: "(UTC+06:00) Dhaka" },
  { id: "Asia/Yangon", label: "(UTC+06:30) Yangon (Rangoon)" },
  { id: "Asia/Bangkok", label: "(UTC+07:00) Bangkok, Hanoi, Jakarta" },
  { id: "Asia/Barnaul", label: "(UTC+07:00) Barnaul, Gorno-Altaysk" },
  { id: "Asia/Krasnoyarsk", label: "(UTC+07:00) Krasnoyarsk" },
  { id: "Asia/Novosibirsk", label: "(UTC+07:00) Novosibirsk" },
  { id: "Asia/Shanghai", label: "(UTC+08:00) Beijing, Chongqing, Hong Kong, Urumqi" },
  { id: "Asia/Irkutsk", label: "(UTC+08:00) Irkutsk" },
  { id: "Asia/Singapore", label: "(UTC+08:00) Kuala Lumpur, Singapore" },
  { id: "Australia/Perth", label: "(UTC+08:00) Perth" },
  { id: "Asia/Taipei", label: "(UTC+08:00) Taipei" },
  { id: "Asia/Ulaanbaatar", label: "(UTC+08:00) Ulaanbaatar" },
  { id: "Australia/Eucla", label: "(UTC+08:45) Eucla" },
  { id: "Asia/Chita", label: "(UTC+09:00) Chita" },
  { id: "Asia/Tokyo", label: "(UTC+09:00) Osaka, Sapporo, Tokyo" },
  { id: "Asia/Pyongyang", label: "(UTC+09:00) Pyongyang" },
  { id: "Asia/Seoul", label: "(UTC+09:00) Seoul" },
  { id: "Asia/Yakutsk", label: "(UTC+09:00) Yakutsk" },
  { id: "Australia/Adelaide", label: "(UTC+09:30) Adelaide" },
  { id: "Australia/Darwin", label: "(UTC+09:30) Darwin" },
  { id: "Australia/Brisbane", label: "(UTC+10:00) Brisbane" },
  { id: "Australia/Sydney", label: "(UTC+10:00) Canberra, Melbourne, Sydney" },
  { id: "Pacific/Port_Moresby", label: "(UTC+10:00) Guam, Port Moresby" },
  { id: "Australia/Hobart", label: "(UTC+10:00) Hobart" },
  { id: "Asia/Vladivostok", label: "(UTC+10:00) Vladivostok" },
  { id: "Australia/Lord_Howe", label: "(UTC+10:30) Lord Howe Island" },
  { id: "Pacific/Bougainville", label: "(UTC+11:00) Bougainville Island" },
  { id: "Asia/Magadan", label: "(UTC+11:00) Magadan" },
  { id: "Pacific/Norfolk", label: "(UTC+11:00) Norfolk Island" },
  { id: "Asia/Sakhalin", label: "(UTC+11:00) Sakhalin" },
  { id: "Pacific/Guadalcanal", label: "(UTC+11:00) Solomon Is., New Caledonia" },
  { id: "Asia/Kamchatka", label: "(UTC+12:00) Anadyr, Petropavlovsk-Kamchatsky" },
  { id: "Pacific/Auckland", label: "(UTC+12:00) Auckland, Wellington" },
  { id: "Etc/GMT-12", label: "(UTC+12:00) Coordinated Universal Time+12" },
  { id: "Pacific/Fiji", label: "(UTC+12:00) Fiji" },
  { id: "Pacific/Chatham", label: "(UTC+12:45) Chatham Islands" },
  { id: "Pacific/Tongatapu", label: "(UTC+13:00) Nuku'alofa" },
  { id: "Pacific/Apia", label: "(UTC+13:00) Samoa" },
  { id: "Pacific/Kiritimati", label: "(UTC+14:00) Kiritimati Island" },
];

/** Current UTC offset (minutes) of an IANA zone, accounting for DST. */
function zoneOffsetMinutes(id: string): number | null {
  try {
    const now = new Date();
    const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
    const local = new Date(now.toLocaleString("en-US", { timeZone: id }));
    return Math.round((local.getTime() - utc.getTime()) / 60_000);
  } catch {
    return null;
  }
}

/**
 * Best default zone id for the current user: an exact IANA match if the browser
 * zone is in the list, otherwise the first entry sharing the current UTC offset,
 * else UTC.
 */
export function defaultTimezoneId(): string {
  let local = "Etc/UTC";
  try {
    local = Intl.DateTimeFormat().resolvedOptions().timeZone || "Etc/UTC";
  } catch {
    /* ignore */
  }
  if (TIMEZONES.some((z) => z.id === local)) return local;
  const localOffset = zoneOffsetMinutes(local);
  if (localOffset != null) {
    const match = TIMEZONES.find((z) => zoneOffsetMinutes(z.id) === localOffset);
    if (match) return match.id;
  }
  return "Etc/UTC";
}

/** Display label for a stored zone id (falls back to the raw id). */
export function timezoneLabel(id: string): string {
  return TIMEZONES.find((z) => z.id === id)?.label ?? id;
}

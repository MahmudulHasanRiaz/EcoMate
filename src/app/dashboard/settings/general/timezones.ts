// Curated IANA timezone list with offsets (static; no dependency on moment)
const timezones = [
  { value: 'Pacific/Midway', label: '(GMT-11:00) Midway Island' },
  { value: 'America/Adak', label: '(GMT-10:00) Hawaii-Aleutian' },
  { value: 'America/Anchorage', label: '(GMT-09:00) Alaska' },
  { value: 'America/Los_Angeles', label: '(GMT-08:00) Pacific Time (US & Canada)' },
  { value: 'America/Denver', label: '(GMT-07:00) Mountain Time (US & Canada)' },
  { value: 'America/Chicago', label: '(GMT-06:00) Central Time (US & Canada)' },
  { value: 'America/New_York', label: '(GMT-05:00) Eastern Time (US & Canada)' },
  { value: 'America/Sao_Paulo', label: '(GMT-03:00) Brasilia' },
  { value: 'Atlantic/Reykjavik', label: '(GMT+00:00) Reykjavik' },
  { value: 'Europe/London', label: '(GMT+00:00) London' },
  { value: 'Europe/Berlin', label: '(GMT+01:00) Berlin' },
  { value: 'Europe/Athens', label: '(GMT+02:00) Athens' },
  { value: 'Asia/Dubai', label: '(GMT+04:00) Dubai' },
  { value: 'Asia/Karachi', label: '(GMT+05:00) Karachi' },
  { value: 'Asia/Dhaka', label: '(GMT+06:00) Dhaka' },
  { value: 'Asia/Bangkok', label: '(GMT+07:00) Bangkok' },
  { value: 'Asia/Shanghai', label: '(GMT+08:00) Shanghai' },
  { value: 'Asia/Tokyo', label: '(GMT+09:00) Tokyo' },
  { value: 'Australia/Sydney', label: '(GMT+10:00) Sydney' },
  { value: 'Pacific/Auckland', label: '(GMT+12:00) Auckland' },
];

export default timezones;

# Phone Metrics System - How Everything Works

Last updated: April 8, 2026

---

## 1. Where Do Calls Come From?

Two phone systems feed into one database:

| Source | What it is | How it syncs |
|--------|-----------|--------------|
| **CIK** | Office phone system. Each store (BC Transparent, RF Transparent) has its own CIK portal. | Scraper logs into each store's QCWS portal, downloads CSV for last 3 months. |
| **Grasshopper** | VoIP service. Single account, two virtual numbers (VPS). Calls come in on GH, then forward to CIK phones. | Scraper logs into GH portal, downloads one CSV report (last 90 days), splits by VPS number to determine which store. |

**VPS-to-store mapping:**
- `855-452-7715` -> RF Transparent
- `800-549-0162` -> BC Transparent

All records end up in the `call_records` table in Supabase.

---

## 2. What Counts as a "Call"?

Every row in `call_records` is one call. But not every phone interaction becomes a row -- both scrapers filter before inserting.

### What CIK includes:
- Every record from their CDR (Call Detail Record) CSV
- Must have: `call_start`, `from_number`, `to_number`, and `direction` = "inbound" or "outbound"
- **Excludes:** Calls where `from_number` is a Grasshopper VPS number (those are forwarded GH calls -- GH owns the record with the real caller ID)

### What Grasshopper includes:
- Only call types that represent real conversations or voicemails
- **Included types:** Follow Me Connected, Mobile Inbound, Mobile Outbound Connected, Voice Mail, Conference Call, Click to Call, Supervised Transfer
- **Excluded types:** Hangups, Follow Me Not Connected, Forwarded Call legs (to avoid duplicating the CIK side), Fax, Mobile Outbound Not Connected

### Deduplication (preventing double-counting):

When a customer calls the Grasshopper number, GH forwards it to a CIK phone. Both systems record the call. To avoid counting it twice:

1. **At scrape time (CIK side):** CIK scraper filters out any inbound call where `from_number` matches a GH VPS number. These are the forwarded leg -- GH already has the real caller's number.

2. **At query time (API side):** If a CIK inbound call has the same `from_number` as a GH inbound call within **120 seconds**, the CIK record is dropped. GH "owns" the call because it has the original caller info.

---

## 3. The `endpoint` Field - What It Means

This is the most important field for determining call outcomes. It works differently per source:

### CIK endpoint values (from real data):
| Value | Meaning | How the system treats it |
|-------|---------|------------------------|
| `NULL` (177 inbound) | Call rang but nobody picked up | **Unanswered / Missed** |
| `206`, `201`, `101`, etc. | Extension number that answered | **Answered** (any truthy, non-VM value) |
| `VM_rftransparent_206` | Went to voicemail at extension 206 | **Voicemail** (contains "vm") |
| `VM_qcws_101` | Went to voicemail at extension 101 | **Voicemail** (contains "vm") |

### Grasshopper endpoint values (from real data):
| Value | Meaning | How the system treats it |
|-------|---------|------------------------|
| `answered` (175 inbound, 84 outbound) | Call was connected and answered | **Answered** |
| `vm` (25 inbound) | Caller left a voicemail | **Voicemail** |

### How the system categorizes:
- **Answered** = has an endpoint AND endpoint does NOT contain "vm"
- **Voicemail** = endpoint contains "vm" (case-insensitive)
- **Unanswered** = endpoint is NULL (empty/missing)
- **Missed** = Unanswered OR Voicemail (i.e., a person did not pick up the phone)

---

## 4. Metric Definitions

### Total Calls
**What it is:** Count of all call records in the selected date range, after deduplication.

**Formula:** `count(all records)`

---

### Inbound / Outbound
**What it is:** Calls split by direction.

- **Inbound** = customer called us (`direction = "inbound"`)
- **Outbound** = we called a customer (`direction = "outbound"`)

---

### Voicemail Calls
**What it is:** Inbound calls where the customer left a voicemail.

**Formula:** `count(inbound calls where endpoint contains "vm")`

---

### Unanswered (shown as "Unanswered" in dashboard)
**What it is:** Inbound calls where a person did NOT answer. This includes both calls that rang and were ignored AND calls that went to voicemail. The thinking: even if someone left a voicemail, a person still didn't pick up -- it needs follow-up.

**Formula:** `count(inbound calls where endpoint is NULL or endpoint contains "vm")`

**Note:** This count represents ALL calls that initially went unanswered in the period, regardless of whether the team later called the customer back. It's "how many times did we fail to pick up", not "how many still need attention". The "Needs Callback" tab shows only the unresolved subset.

---

### Miss Rate
**What it is:** Percentage of inbound calls that went unanswered, **weekdays only**. Weekends are excluded because missed weekend calls are expected (office is closed).

**Formula:**
```
miss_rate = (weekday unanswered calls / weekday inbound calls) x 100
```

- Saturday and Sunday calls are excluded from both numerator and denominator
- A "weekday" is determined by the call's timestamp (Mon-Fri)
- Industry benchmark: 10-20%

---

### Recovery Rate
**What it is:** Of all the calls that initially went unanswered, what percentage were eventually resolved? A call is "recovered" if within **48 hours**, either:

1. **We called them back** -- an outbound call was made TO that customer's phone number, OR
2. **They called again and got through** -- another inbound call FROM that number was answered (not voicemail)

**Formula:**
```
recovery_rate = (recovered calls / all unanswered calls) x 100
```

**Important details:**
- The 48-hour window prevents stale outbound calls (e.g., 2 weeks later) from inflating the rate
- Both CIK and GH outbound calls count as callbacks
- A customer calling back and reaching voicemail again does NOT count as recovered
- Phone numbers are normalized (country code stripped) so a CIK callback to "14165551234" matches a GH missed call from "4165551234"
- Industry benchmark: 60-80%

---

### Avg Response Time
**What it is:** When the team calls back a missed caller, how long did it take? Measured in minutes from the missed inbound call to the first outbound callback.

**Formula:**
```
avg_response_time = average(time from missed call to first outbound callback)
```

**Important details:**
- Only measures **outbound callbacks** (team effort). If the customer calls back themselves, that doesn't count as "response time" because it wasn't the team's action
- Only includes calls that were actually recovered via outbound callback
- Capped at 48 hours -- any outbound call to the number more than 48h later is considered unrelated
- Industry benchmark: under 60 minutes

---

### Outbound Callback Rate
**What it is:** Of all unanswered calls, what percentage did the team proactively call back (outbound)?

**Formula:**
```
outbound_callback_rate = (unanswered calls with an outbound callback within 48h / all unanswered calls) x 100
```

This is different from recovery rate because recovery rate also counts customers who called back on their own. This metric specifically measures team proactiveness.

---

### Avg Duration (Inbound)
**What it is:** Average call length for answered inbound calls.

**Formula:**
```
avg_duration_inbound = average(duration_min) for inbound calls where:
  - endpoint exists AND
  - endpoint does NOT contain "vm" AND
  - duration > 0 minutes
```

Zero-duration calls (picked up and immediately hung up) are excluded.

---

### Avg Duration (Outbound)
**What it is:** Average call length for outbound calls that connected.

**Formula:**
```
avg_duration_outbound = average(duration_min) for outbound calls where:
  - duration > 0 minutes
```

---

### First-Time vs Returning Callers
**What it is:** Of the unique phone numbers that called in during this period, how many have called before?

- **First-time caller** = this phone number has NO inbound call records before the start of the selected date range
- **Returning caller** = this phone number has at least one inbound call before the selected date range

---

## 5. The Callbacks Tab

The callbacks tab shows **unresolved missed calls grouped by phone number**. A call appears here if:

1. It's inbound
2. It was not answered by a person (no endpoint, or voicemail)
3. No outbound callback was made to that number within 48 hours
4. The customer didn't call back and reach someone within 48 hours

### Priority levels:
| Priority | Criteria |
|----------|---------|
| **High** | 3 or more unanswered call attempts from this number |
| **Medium** | 2 unanswered call attempts |
| **Low** | 1 unanswered call attempt |

### What "resolved" means:
A missed call disappears from the callbacks tab when:
- Someone makes an outbound call to that number (within 48h), OR
- The customer calls back and gets answered (not voicemail, within 48h)

---

## 6. Patterns View

### Hourly breakdown:
- All calls bucketed into 24 hours (Eastern Time)
- Shows: total calls, inbound, missed, answered per hour
- Miss rate per hour = missed / inbound (not total)

### Daily breakdown:
- All calls bucketed by day of week (Mon-Sun)
- Shows: total calls, inbound, missed per day
- Miss rate per day = missed / inbound (not total)

---

## 7. Data Sources - Phone Number Formats

CIK and Grasshopper store phone numbers differently:

| Source | Format | Example |
|--------|--------|---------|
| CIK | With country code | `14166134388` |
| Grasshopper | Without country code | `4166134388` |

The system normalizes these by stripping the leading "1" from 11-digit numbers before comparing. This happens everywhere phone numbers are matched (deduplication, callback detection, etc.).

---

## 8. Timestamps & Timezones

- **CIK:** Timestamps stored as-is from CSV (UTC with timezone offset)
- **Grasshopper:** Timestamps converted from Eastern Time to UTC during scraping, stored with `+00:00` suffix
- **Hourly/daily patterns:** Converted back to Eastern Time for display
- **Miss rate weekday check:** Uses the call's timestamp to determine day of week

---

## 9. What Was Broken (Fixed April 8, 2026)

| Bug | Impact | Fix |
|-----|--------|-----|
| GH outbound calls had from/to reversed | `to_number` was always "unknown" for GH outbound, so GH callbacks could never be matched. Recovery rate was understated, avg response time was incomplete. | Always map Caller ID -> from, Connecting # -> to regardless of direction |
| Callbacks tab didn't normalize phone numbers | CIK callback to "14165551234" wouldn't match GH missed call from "4165551234" | Added phone normalization to callbacks view |
| Callbacks tab excluded voicemails | Summary said "50 missed" but callbacks only showed 30 (excluded 20 VMs) | Callbacks tab now includes voicemails as needing follow-up |
| Daily miss rate divided by total calls | Outbound calls diluted the miss rate | Changed to divide by inbound calls only |
| No time limit on callback matching | Outbound call 3 weeks later counted as "recovery" | Capped at 48 hours |

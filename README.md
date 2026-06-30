# VendorPulse Renewal Tracker — V1.0

VendorPulse is a Salesforce Lightning Web Component (LWC) application built for the **Genpact SPS (Strategic Procurement Solutions)** team to replace a manual Excel-based PO renewal tracker. It gives  the wider SPS team a single live view of every renewal — its hygiene status, urgency, ACV, and year-over-year trend — without the spreadsheet version conflicts and stale data that come with email-based tracking.

---

## Why this exists

The original process: a shared Excel file tracking PO renewals, manually updated, prone to missed renewal windows and version conflicts. VendorPulse moves that into Salesforce as a single source of truth with automated hygiene alerts, multi-year contract handling, and built-in import/export tooling.

---

## Features

### Tracker
- Sortable (ascending/descending) and freely **draggable columns** with a one-click reset to default order
- Global search plus category/status filters
- Pagination with selectable page size (10 / 20 / 30 / 50) and direct page-jump
- Inline Add / Edit modal with client-side validation
- **End Date auto-calculated** from Start Date + Duration (still manually overridable)

### Quarterly / FY View
- Genpact financial year (Apr–Mar) aware — Q1 Apr–Jun, Q2 Jul–Sep, Q3 Oct–Dec, Q4 Jan–Mar
- FY and quarter filter chips, with renewals grouped and ACV-subtotaled per quarter

### Dashboard
- 5 KPI cards (Total ACV, Renewed YTD, Overdue, In Progress, Active Renewals)
- Monthly expiry bar chart, hygiene status breakdown, urgency breakdown
- ACV by OEM and by category
- Multi-year (up to 3-year) YoY ACV comparison — hover any bar/widget for exact figures
- Renewal health score ring, savings summary, quarterly mini chart
- Top 5 renewals needing immediate action

### Multi-Year PO Splitting
- Detects contracts with Duration > 1 year and offers to split into individual yearly records
- **Built-in pro-rata calculator** (`ompCalc`) — handles mid-year contract starts correctly:
  - Pro-rata (day-based) — default, accounts for partial years automatically
  - Equal split
  - Custom per-year entry
  - Percentage-based entry
  - Live validation that yearly ACVs sum exactly to TCV
  - Auto-closes when the PO record is saved

### Data Import (`ompCsvImport`)
- In-app CSV import tool, Data Loader–style 4-step flow: **Upload → Auto-map → Preview → Import**
- Auto-detects common column header variants (OEM, ACV, PO Number, dates in dd/mm/yyyy or yyyy-mm-dd, etc.)
- Manual remap available for any column; required-field validation before import
- Partial-success import with row-level error reporting
- CSV template download and current-view export to CSV

### Hygiene Automation
- `OMP_RenewalHygieneScheduler` runs daily at 07:00 IST
- Tiered email alerts at 90 / 60 / 30 days before expiry, plus daily overdue escalation
- 30-day and overdue alerts copy the buyer's manager automatically
- Alert deduplication via `Alert_Sent_90__c` / `_60__c` / `_30__c` checkboxes

---

## Project structure

```
force-app/main/default/
├── classes/
│   ├── OMP_RenewalController.cls            — main controller (CRUD, dashboard metrics, multi-year split, CSV import)
│   ├── OMP_RenewalControllerTest.cls
│   ├── OMP_RenewalHygieneScheduler.cls       — daily scheduled alert job
│   └── OMP_RenewalHygieneSchedulerTest.cls
└── lwc/
    ├── ompRenewalTracker/                    — main app: tracker, quarterly/FY, dashboard, closure log
    ├── ompCalc/                              — floating pro-rata split calculator
    └── ompCsvImport/                         — CSV import tool with auto field-mapping
```

---

## Setup

**Prerequisites**
- Salesforce CLI (`sf`)
- A Salesforce org with the `OMP_Renewal__c` custom object and its fields deployed (see Data Model below)

**Deploy**
```bash
git clone https://github.com/mattey2026/VendorPulse.git
cd VendorPulse
sf project deploy start --target-org <your-org-alias>
```

**Schedule the daily hygiene job** (run once in Developer Console or via Anonymous Apex)
```apex
System.schedule(
    'VendorPulse Renewal Hygiene Daily',
    '0 0 7 * * ?',
    new OMP_RenewalHygieneScheduler()
);
```

---

## Data model — `OMP_Renewal__c`

Key fields used by the application:

| Field | Type | Notes |
|---|---|---|
| `OEM__c` | Text | OEM / product name |
| `Vendor_Name__c` | Text | Reseller / vendor of record |
| `Description__c` | Text | Renewal description |
| `PO_Number__c` | Text | Format `14012XXXXX` |
| `Category__c` | Picklist | IT&T / License / AMC / Services |
| `Currency__c` | Picklist | INR / USD / EUR / GBP |
| `PO_Amount__c` | Currency | Local currency PO amount |
| `Estimated_PO_TCV_USD__c` | Currency | Total contract value in USD |
| `ACV_USD__c` | Currency | Annual contract value in USD |
| `Last_Year_ACV_USD__c` | Currency | Prior year ACV, used for YoY variance |
| `Due_Year__c` | Number | Calendar year the renewal is due |
| `Start_Date__c` / `End_Date__c` | Date | Contract period |
| `Days_To_Renewal__c` | Formula | Days remaining to `End_Date__c` |
| `Duration_Years__c` | Number | Contract length in years |
| `Sourcing_Buyer__c` | Lookup(User) | Owning SPS buyer |
| `Hygiene_Status__c` | Picklist | Identified / Engaged / Approval / PR Created / Closed |
| `Closure_Date__c` | Date | Set when status = Closed |
| `Alert_Sent_90__c` / `_60__c` / `_30__c` | Checkbox | Alert deduplication flags |

---

## Tech notes

- API version: 59.0
- No external dependencies — pure LWC + Apex, no managed packages required
- All charts and visualizations are hand-built (SVG/CSS), no third-party charting library
- Apex respects platform constraints throughout (e.g. typed variables are never declared inside `for` loop bodies, SObject construction avoids inline method calls per Apex parser rules)

---

## Roadmap

- [ ] Approval workflow (VGO → Legal → Business sign-off) enforced in-app
- [ ] Smart alert centre tab (centralised view of all open alerts)
- [ ] One-click vendor email templates (RFQ, reminder, escalation)
- [ ] Vendor negotiation log and scorecard
- [ ] Budget vs. actual tracking by category
- [ ] AI-assisted PO document extraction (upload PDF → auto-create renewal record)

---

## Org

Built for **Genpact SPS (Strategic Procurement Solutions)**.
Maintained by Sumit Mattey.

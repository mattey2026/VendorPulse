import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import bulkImportRenewals from '@salesforce/apex/OMP_RenewalController.bulkImportRenewals';

// Target VendorPulse fields — matches Data Loader style field list
const TARGET_FIELDS = [
    { value: '', label: '-- Skip this column --' },
    { value: 'OEM__c',               label: 'OEM *' },
    { value: 'Vendor_Name__c',       label: 'Vendor Name' },
    { value: 'Description__c',       label: 'Description *' },
    { value: 'PO_Number__c',         label: 'PO Number' },
    { value: 'Category__c',          label: 'Category' },
    { value: 'Currency__c',          label: 'Currency' },
    { value: 'PO_Amount__c',         label: 'PO Amount' },
    { value: 'ACV_USD__c',           label: 'ACV (USD)' },
    { value: 'Last_Year_ACV_USD__c', label: 'Last Year ACV (USD)' },
    { value: 'Duration_Years__c',    label: 'Duration (Years)' },
    { value: 'Start_Date__c',        label: 'Start Date *' },
    { value: 'End_Date__c',          label: 'End Date *' },
    { value: 'Hygiene_Status__c',    label: 'Hygiene Status' }
];

// Auto-detect mapping: csv header (lowercased, no spaces/underscores) -> target field
const AUTO_MAP = {
    'oem': 'OEM__c', 'oemname': 'OEM__c',
    'vendorname': 'Vendor_Name__c', 'vendor': 'Vendor_Name__c',
    'description': 'Description__c', 'desc': 'Description__c',
    'ponumber': 'PO_Number__c', 'pono': 'PO_Number__c', 'po': 'PO_Number__c',
    'category': 'Category__c',
    'currency': 'Currency__c',
    'poamount': 'PO_Amount__c', 'amount': 'PO_Amount__c', 'amountasperpocurrency': 'PO_Amount__c',
    'acvusd': 'ACV_USD__c', 'acv': 'ACV_USD__c', 'annualvalueusdacv': 'ACV_USD__c', 'annualvalue': 'ACV_USD__c',
    'lastyearacvusd': 'Last_Year_ACV_USD__c', 'lastyearacv': 'Last_Year_ACV_USD__c', 'lastyearvalue': 'Last_Year_ACV_USD__c',
    'durationyears': 'Duration_Years__c', 'duration': 'Duration_Years__c', 'durationdays': 'Duration_Years__c',
    'startdate': 'Start_Date__c',
    'enddate': 'End_Date__c',
    'hygienestatus': 'Hygiene_Status__c', 'status': 'Hygiene_Status__c'
};

function normalizeHeader(h) {
    return (h || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

// Simple CSV parser handling quoted fields with commas
function parseCSV(text) {
    const rows = [];
    let row = [];
    let field = '';
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inQuotes) {
            if (c === '"') {
                if (text[i + 1] === '"') { field += '"'; i++; }
                else inQuotes = false;
            } else field += c;
        } else {
            if (c === '"') inQuotes = true;
            else if (c === ',') { row.push(field); field = ''; }
            else if (c === '\n' || c === '\r') {
                if (c === '\r' && text[i + 1] === '\n') i++;
                row.push(field); field = '';
                if (row.some(f => f !== '')) rows.push(row);
                row = [];
            } else field += c;
        }
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => r.length > 0);
}

// Try to coerce a date string into ISO yyyy-mm-dd
function coerceDate(val) {
    if (!val) return '';
    val = val.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
    // dd/mm/yyyy or mm/dd/yyyy or dd-mm-yyyy
    const m = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m) {
        let [, a, b, y] = m;
        // assume dd/mm/yyyy (common in India/Genpact context)
        let day = parseInt(a, 10), month = parseInt(b, 10);
        if (month > 12) { const t = day; day = month; month = t; } // swap if clearly mm/dd
        return y + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
    }
    const d = new Date(val);
    if (!isNaN(d.getTime())) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }
    return val;
}

export default class OmpCsvImport extends LightningElement {

    @track step          = 1;  // 1=upload, 2=mapping, 3=preview, 4=result
    @track fileName       = '';
    @track csvHeaders     = [];
    @track csvRows        = [];   // raw 2D array
    @track fieldMappings  = [];   // [{csvHeader, mappedTo, options}]
    @track isProcessing   = false;
    @track importResult   = null;
    @track parseError     = '';

    get isStep1() { return this.step === 1; }
    get isStep2() { return this.step === 2; }
    get isStep3() { return this.step === 3; }
    get isStep4() { return this.step === 4; }

    get targetFieldOptions() { return TARGET_FIELDS; }

    // ── STEP 1: File upload ────────────────────────────────────────────────
    handleFileChange(event) {
        const file = event.target.files[0];
        if (!file) return;
        this.fileName = file.name;
        this.parseError = '';

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = reader.result;
                const parsed = parseCSV(text);
                if (parsed.length < 2) {
                    this.parseError = 'CSV file must have a header row and at least one data row.';
                    return;
                }
                this.csvHeaders = parsed[0].map(h => h.trim());
                this.csvRows = parsed.slice(1);
                this._buildAutoMapping();
                this.step = 2;
            } catch (e) {
                this.parseError = 'Could not parse this file. Please ensure it is a valid CSV.';
            }
        };
        reader.onerror = () => { this.parseError = 'Failed to read the file.'; };
        reader.readAsText(file);
    }

    handleDragOver(e) { e.preventDefault(); }
    handleDrop(e) {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) {
            const input = this.template.querySelector('input[type="file"]');
            // Simulate file selection
            const dt = new DataTransfer();
            dt.items.add(file);
            input.files = dt.files;
            this.handleFileChange({ target: { files: dt.files } });
        }
    }

    // ── STEP 2: Auto field mapping (Data Loader style) ──────────────────────
    _buildAutoMapping() {
        const usedTargets = new Set();
        this.fieldMappings = this.csvHeaders.map((header, idx) => {
            const norm = normalizeHeader(header);
            let auto = AUTO_MAP[norm] || '';
            if (auto && usedTargets.has(auto)) auto = ''; // avoid double-mapping
            if (auto) usedTargets.add(auto);
            return {
                idx,
                csvHeader: header,
                mappedTo: auto,
                sample: this.csvRows[0] ? (this.csvRows[0][idx] || '') : '',
                isAutoMatched: !!auto
            };
        });
    }

    handleMappingChange(event) {
        const idx = parseInt(event.target.dataset.idx, 10);
        const value = event.detail.value;
        const updated = [...this.fieldMappings];
        updated[idx] = { ...updated[idx], mappedTo: value, isAutoMatched: false };
        this.fieldMappings = updated;
    }

    get mappedRequiredFields() {
        const mapped = new Set(this.fieldMappings.map(m => m.mappedTo).filter(Boolean));
        return mapped;
    }
    get hasOEMMapped()  { return this.mappedRequiredFields.has('OEM__c'); }
    get hasDescMapped() { return this.mappedRequiredFields.has('Description__c'); }
    get hasStartMapped(){ return this.mappedRequiredFields.has('Start_Date__c'); }
    get hasEndMapped()  { return this.mappedRequiredFields.has('End_Date__c'); }
    get canProceedToPreview() {
        return this.hasOEMMapped && this.hasDescMapped && this.hasStartMapped && this.hasEndMapped;
    }
    get canProceedToPreviewDisabled() { return !this.canProceedToPreview; }
    get missingRequiredLabel() {
        const missing = [];
        if (!this.hasOEMMapped)  missing.push('OEM');
        if (!this.hasDescMapped) missing.push('Description');
        if (!this.hasStartMapped) missing.push('Start Date');
        if (!this.hasEndMapped)  missing.push('End Date');
        return missing.join(', ');
    }

    get autoMatchedCount() { return this.fieldMappings.filter(m => m.isAutoMatched).length; }
    get totalColumnsCount() { return this.fieldMappings.length; }

    goToPreview() {
        if (!this.canProceedToPreview) return;
        this.step = 3;
    }
    backToMapping() { this.step = 2; }
    backToUpload()  { this.step = 1; this.csvHeaders = []; this.csvRows = []; this.fieldMappings = []; this.fileName = ''; }

    // ── STEP 3: Preview built rows ────────────────────────────────────────
    get previewRecords() {
        const mapping = this.fieldMappings.filter(m => m.mappedTo);
        return this.csvRows.slice(0, 10).map((row, rIdx) => {
            const obj = { _row: rIdx + 2 };
            mapping.forEach(m => {
                let val = row[m.idx] !== undefined ? row[m.idx].trim() : '';
                if (m.mappedTo === 'Start_Date__c' || m.mappedTo === 'End_Date__c') val = coerceDate(val);
                obj[m.mappedTo] = val;
            });
            return {
                key: rIdx,
                rowNum: rIdx + 2,
                oem: obj.OEM__c || '—',
                desc: obj.Description__c || '—',
                po: obj.PO_Number__c || '—',
                acv: obj.ACV_USD__c || '—',
                start: obj.Start_Date__c || '—',
                end: obj.End_Date__c || '—',
                status: obj.Hygiene_Status__c || 'Identified'
            };
        });
    }
    get previewCount() { return this.csvRows.length; }
    get previewShowingLabel() {
        return Math.min(10, this.csvRows.length) + ' of ' + this.csvRows.length;
    }

    // ── STEP 3→4: Import ────────────────────────────────────────────────────
    handleImport() {
        this.isProcessing = true;
        const mapping = this.fieldMappings.filter(m => m.mappedTo);
        const rows = this.csvRows.map(row => {
            const obj = {};
            mapping.forEach(m => {
                let val = row[m.idx] !== undefined ? row[m.idx].trim() : '';
                if (m.mappedTo === 'Start_Date__c' || m.mappedTo === 'End_Date__c') val = coerceDate(val);
                obj[m.mappedTo] = val;
            });
            return obj;
        });

        bulkImportRenewals({ rows })
            .then(result => {
                this.importResult = result;
                this.isProcessing = false;
                this.step = 4;
                if (result.successCount > 0) {
                    this.dispatchEvent(new CustomEvent('importcomplete'));
                }
            })
            .catch(err => {
                this.isProcessing = false;
                this.toast('Error', err.body && err.body.message ? err.body.message : 'Import failed.', 'error');
            });
    }

    get hasImportErrors() { return this.importResult && this.importResult.errors && this.importResult.errors.length > 0; }
    get indexedErrors() {
        if (!this.importResult || !this.importResult.errors) return [];
        return this.importResult.errors.map((text, i) => ({ key: 'err-' + i, text }));
    }

    startOver() {
        this.step = 1;
        this.csvHeaders = [];
        this.csvRows = [];
        this.fieldMappings = [];
        this.fileName = '';
        this.importResult = null;
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('closeimport'));
    }

    stopProp(e) { e.stopPropagation(); }

    downloadTemplate() {
        const csv = 'OEM,Vendor Name,Description,PO Number,Currency,PO Amount,Category,ACV USD,'
            + 'Last Year ACV USD,Start Date,End Date,Duration Years,Hygiene Status\n'
            + 'Nitro,3R Infotech Pvt. Ltd.,Nitro PDF Standard for 8 Users,1401240024,INR,108100,'
            + 'IT&T,1299,1250,2025-05-31,2026-05-31,1,Identified\n';
        const a = document.createElement('a');
        a.href = 'data:text/csv;charset=utf-8,' + encodeURIComponent(csv);
        a.download = 'VendorPulse_Import_Template.csv';
        a.click();
    }

    toast(title, message, variant) {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }
}

import { LightningElement, api, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { getRecord }  from 'lightning/uiRecordApi';
import saveRenewal    from '@salesforce/apex/OMP_RenewalController.saveRenewal';
import sendEscalation from '@salesforce/apex/OMP_RenewalController.sendEscalationEmail';

const FIELDS = [
    'OMP_Renewal__c.OEM__c','OMP_Renewal__c.Vendor_Name__c','OMP_Renewal__c.Description__c',
    'OMP_Renewal__c.PO_Number__c','OMP_Renewal__c.Category__c','OMP_Renewal__c.Currency__c',
    'OMP_Renewal__c.PO_Amount__c','OMP_Renewal__c.ACV_USD__c','OMP_Renewal__c.Last_Year_ACV_USD__c',
    'OMP_Renewal__c.Estimated_PO_TCV_USD__c','OMP_Renewal__c.Start_Date__c','OMP_Renewal__c.End_Date__c',
    'OMP_Renewal__c.Duration_Years__c','OMP_Renewal__c.Due_Year__c','OMP_Renewal__c.Hygiene_Status__c',
    'OMP_Renewal__c.Closure_Date__c','OMP_Renewal__c.Renewal_Quote__c','OMP_Renewal__c.Escalation_Notes__c',
    'OMP_Renewal__c.Days_To_Renewal__c','OMP_Renewal__c.Sourcing_Buyer__c'
];

export default class OmpRenewalModal extends LightningElement {
    @api renewalId;
    @api isNew;

    @track renewal = {
        Currency__c: 'INR',
        Category__c: 'IT&T',
        Hygiene_Status__c: 'Identified'
    };
    @track isSaving = false;

    @wire(getRecord, { recordId: '$renewalId', fields: FIELDS })
    wiredRecord({ data, error }) {
        if (data) {
            const f = data.fields;
            this.renewal = {
                Id:                       this.renewalId,
                OEM__c:                   f.OEM__c.value,
                Vendor_Name__c:           f.Vendor_Name__c.value,
                Description__c:           f.Description__c.value,
                PO_Number__c:             f.PO_Number__c.value,
                Category__c:              f.Category__c.value,
                Currency__c:              f.Currency__c.value,
                PO_Amount__c:             f.PO_Amount__c.value,
                ACV_USD__c:               f.ACV_USD__c.value,
                Last_Year_ACV_USD__c:     f.Last_Year_ACV_USD__c.value,
                Estimated_PO_TCV_USD__c:  f.Estimated_PO_TCV_USD__c.value,
                Start_Date__c:            f.Start_Date__c.value,
                End_Date__c:              f.End_Date__c.value,
                Duration_Years__c:        f.Duration_Years__c.value,
                Due_Year__c:              f.Due_Year__c.value,
                Hygiene_Status__c:        f.Hygiene_Status__c.value,
                Closure_Date__c:          f.Closure_Date__c.value,
                Renewal_Quote__c:         f.Renewal_Quote__c.value,
                Escalation_Notes__c:      f.Escalation_Notes__c.value,
                Days_To_Renewal__c:       f.Days_To_Renewal__c.value,
                Sourcing_Buyer__c:        f.Sourcing_Buyer__c.value
            };
        }
        if (error) console.error('getRecord error', error);
    }

    // ─── Computed ─────────────────────────────────────────────────────────────
    get modalTitle()  { return this.isNew ? 'Add renewal' : 'Edit renewal — ' + (this.renewal.OEM__c || ''); }
    get saveLabel()   { return this.isSaving ? 'Saving...' : (this.isNew ? 'Add to tracker' : 'Save changes'); }
    get isOverdue()   { return this.renewal.Days_To_Renewal__c != null && this.renewal.Days_To_Renewal__c < 0; }
    get overdueByDays() { return this.renewal.Days_To_Renewal__c != null ? Math.abs(this.renewal.Days_To_Renewal__c) : 0; }

    get showYoYVariance() {
        return this.renewal.ACV_USD__c != null && this.renewal.Last_Year_ACV_USD__c != null && this.renewal.Last_Year_ACV_USD__c > 0;
    }
    get yoyVariance() {
        if (!this.showYoYVariance) return '';
        const diff = this.renewal.ACV_USD__c - this.renewal.Last_Year_ACV_USD__c;
        return (diff >= 0 ? '+' : '') + '$' + Math.abs(diff).toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    get varianceClass() {
        const diff = this.renewal.ACV_USD__c - this.renewal.Last_Year_ACV_USD__c;
        return 'omp-variance-value ' + (diff > 0 ? 'omp-variance--up' : diff < 0 ? 'omp-variance--down' : '');
    }

    get categoryOptions() {
        return [
            { label: 'IT&T',     value: 'IT&T' },
            { label: 'License',  value: 'License' },
            { label: 'AMC',      value: 'AMC' },
            { label: 'Services', value: 'Services' }
        ];
    }
    get currencyOptions() {
        return [
            { label: 'INR', value: 'INR' },
            { label: 'USD', value: 'USD' },
            { label: 'EUR', value: 'EUR' },
            { label: 'GBP', value: 'GBP' }
        ];
    }
    get statusOptions() {
        return [
            { label: 'Identified',  value: 'Identified' },
            { label: 'Engaged',     value: 'Engaged' },
            { label: 'Approval',    value: 'Approval' },
            { label: 'PR Created',  value: 'PR Created' },
            { label: 'Closed',      value: 'Closed' }
        ];
    }

    // ─── Handlers ─────────────────────────────────────────────────────────────
    handleFieldChange(evt) {
        const field = evt.target.dataset.field;
        const value = evt.target.type === 'checkbox' ? evt.target.checked : evt.detail.value;
        this.renewal = { ...this.renewal, [field]: value };
    }

    handleSave() {
        if (!this.validateForm()) return;
        this.isSaving = true;
        saveRenewal({ renewal: this.renewal })
            .then(() => {
                this.isSaving = false;
                this.dispatchEvent(new CustomEvent('save'));
            })
            .catch(err => {
                this.isSaving = false;
                const msg = err.body?.pageErrors?.[0]?.message || err.body?.message || 'Save failed.';
                this.dispatchEvent(new ShowToastEvent({ title: 'Error', message: msg, variant: 'error' }));
            });
    }

    handleClose() { this.dispatchEvent(new CustomEvent('close')); }

    handleEscalate() {
        const body = 'URGENT — RENEWAL OVERDUE\n\n'
            + 'OEM: ' + this.renewal.OEM__c + '\n'
            + 'Vendor: ' + this.renewal.Vendor_Name__c + '\n'
            + 'PO: ' + (this.renewal.PO_Number__c || 'Not set') + '\n'
            + 'Days overdue: ' + this.overdueByDays + '\n\n'
            + 'Please approve VGO request immediately to reinstate licence.\n\n'
            + (this.renewal.Escalation_Notes__c || '');
        this.dispatchEvent(new ShowToastEvent({
            title: 'Escalation',
            message: 'Escalation email queued. Ensure VGO email is configured in org settings.',
            variant: 'warning'
        }));
    }

    validateForm() {
        const inputs = [...this.template.querySelectorAll('lightning-input, lightning-combobox, lightning-textarea')];
        const valid  = inputs.reduce((ok, inp) => inp.reportValidity() && ok, true);
        if (!valid) {
            this.dispatchEvent(new ShowToastEvent({ title: 'Validation error', message: 'Please fix all required fields.', variant: 'error' }));
        }
        return valid;
    }
}

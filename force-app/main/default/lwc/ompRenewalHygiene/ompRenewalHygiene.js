import { LightningElement, wire, track } from 'lwc';
import getRenewals from '@salesforce/apex/OMP_RenewalController.getRenewals';

export default class OmpRenewalHygiene extends LightningElement {
    @track urgentRenewal = null;

    @wire(getRenewals, { category: '', hygieneStatus: '', searchTerm: '', buyerId: '' })
    wiredRenewals({ data }) {
        if (data && data.length > 0) {
            const sorted = [...data].sort((a, b) =>
                (a.record.Days_To_Renewal__c || 999) - (b.record.Days_To_Renewal__c || 999)
            );
            this.urgentRenewal = sorted[0].record;
        }
    }

    get hasUrgentRenewal() { return this.urgentRenewal != null; }
    get urgentStatus() {
        if (!this.urgentRenewal) return '';
        const d = this.urgentRenewal.Days_To_Renewal__c;
        if (d < 0) return 'OVERDUE';
        if (d <= 30) return 'CRITICAL';
        return this.urgentRenewal.Hygiene_Status__c;
    }
    get urgentBadgeClass() {
        const d = this.urgentRenewal?.Days_To_Renewal__c;
        if (d < 0) return 'hyg-badge hyg-badge--danger';
        if (d <= 30) return 'hyg-badge hyg-badge--warning';
        return 'hyg-badge hyg-badge--info';
    }

    get steps() {
        return [
            { id: '1', milestone: 'Day –90', title: 'Identify renewal',   desc: 'Pull from PO dump. Validate tracker entry. Assign sourcing buyer.', cardClass: 'hyg-step hyg-step--done',    labelClass: 'hyg-step-label hyg-step-label--done' },
            { id: '2', milestone: 'Day –75', title: 'Vendor engagement',  desc: 'Send RFQ / renewal quote to vendor. Receive and compare pricing vs last year.', cardClass: 'hyg-step hyg-step--done',    labelClass: 'hyg-step-label hyg-step-label--done' },
            { id: '3', milestone: 'Day –45', title: 'Approvals',          desc: 'VGO approval → Legal review → Business sign-off. Run concurrently where possible.', cardClass: 'hyg-step hyg-step--active',  labelClass: 'hyg-step-label hyg-step-label--active' },
            { id: '4', milestone: 'Day –15', title: 'PR and PO creation', desc: 'Create PR in SAP, convert to PO, confirm with vendor before end date.', cardClass: 'hyg-step hyg-step--pending', labelClass: 'hyg-step-label hyg-step-label--pending' }
        ];
    }

    get checklistItems() {
        const r = this.urgentRenewal;
        const start   = r?.Start_Date__c ? new Date(r.Start_Date__c) : new Date();
        const end     = r?.End_Date__c   ? new Date(r.End_Date__c)   : new Date();
        const day90   = new Date(end); day90.setDate(day90.getDate() - 90);
        const day75   = new Date(end); day75.setDate(day75.getDate() - 75);
        const day45   = new Date(end); day45.setDate(day45.getDate() - 45);
        const day15   = new Date(end); day15.setDate(day15.getDate() - 15);
        const fmt     = (d) => d.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' });
        const today   = new Date();

        const item = (id, title, owner, date, status) => {
            const isDone    = status === 'Done';
            const isDelayed = status === 'Delayed' || status === 'Blocked' || status === 'Overdue';
            return {
                id, title, owner, targetDate: fmt(date), status,
                iconClass: isDone ? 'hyg-icon hyg-icon--ok' : isDelayed ? 'hyg-icon hyg-icon--danger' : 'hyg-icon hyg-icon--pending',
                icon: isDone ? 'utility:check' : isDelayed ? 'utility:error' : 'utility:clock',
                badgeClass: isDone ? 'hyg-check-badge hyg-check-badge--ok'
                          : isDelayed ? 'hyg-check-badge hyg-check-badge--danger'
                          : 'hyg-check-badge hyg-check-badge--pending'
            };
        };

        return [
            item('1', 'Identify renewal from PO dump',       'Sourcing buyer',  day90, today > day90 ? 'Done' : 'Pending'),
            item('2', 'Validate tracker entry vs PO data',   'Sourcing buyer',  day90, today > day90 ? 'Done' : 'Pending'),
            item('3', 'Send renewal quote request to vendor','Sourcing buyer',  day75, today > day75 ? 'Done' : 'Pending'),
            item('4', 'VGO approval',                        'Procurement Head',day45, today > end ? 'Delayed' : today > day45 ? 'In progress' : 'Pending'),
            item('5', 'Legal review',                        'Legal team',      day45, today > end ? 'Delayed' : 'Pending'),
            item('6', 'Business sign-off',                   'Business owner',  day45, today > end ? 'Blocked' : 'Pending'),
            item('7', 'PR creation in SAP',                  'Sourcing buyer',  day15, today > end ? 'Not started' : 'Pending'),
            item('8', 'PO issuance to vendor',               'Sourcing buyer',  end,   today > end ? 'Overdue' : 'Pending')
        ];
    }
}

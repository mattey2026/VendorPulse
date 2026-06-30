import { LightningElement, api, track } from 'lwc';

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function daysBetween(d1, d2) {
    return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function fmtUSD(n) {
    if (n == null || isNaN(n) || n === 0) return '$0';
    return '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 });
}

function fmtDays(n) {
    return n + ' day' + (n === 1 ? '' : 's');
}

export default class OmpCalc extends LightningElement {

    @api startDate  = '';   // ISO date string from parent e.g. "2024-09-15"
    @api endDate    = '';   // ISO date string from parent e.g. "2027-03-14"
    @api initialTCV = 0;

    @track tcv        = 0;
    @track mode       = 'prorata';   // prorata | equal | custom | pct
    @track customACVs = [];
    @track pcts       = [];

    connectedCallback() {
        this.tcv = Number(this.initialTCV) || 0;
        this._reset();
    }

    _reset() {
        const n = this._yearSegments.length;
        this.customACVs = Array.from({ length: n }, () => null);
        this.pcts       = Array.from({ length: n }, (_, i) => Math.round(100 / n));
    }

    // ── CORE: compute year segments from start/end dates ─────────────────
    get _startDt() {
        return this.startDate ? new Date(this.startDate + 'T00:00:00') : new Date();
    }
    get _endDt() {
        return this.endDate ? new Date(this.endDate + 'T00:00:00') : new Date();
    }
    get _totalDays() {
        const d = daysBetween(this._startDt, this._endDt) + 1;
        return d > 0 ? d : 1;
    }

    // Build year segments — each is one 12-month period (or partial for last segment)
    get _yearSegments() {
        const segments = [];
        const start   = new Date(this._startDt);
        const end     = new Date(this._endDt);
        let cursor    = new Date(start);

        while (cursor <= end) {
            const segStart = new Date(cursor);
            // Next year same date
            const segEndFull = new Date(cursor);
            segEndFull.setFullYear(segEndFull.getFullYear() + 1);
            segEndFull.setDate(segEndFull.getDate() - 1);

            const segEnd = segEndFull <= end ? segEndFull : new Date(end);
            const days   = daysBetween(segStart, segEnd) + 1;

            segments.push({ start: segStart, end: segEnd, days });

            // Advance cursor to next year
            cursor = new Date(cursor);
            cursor.setFullYear(cursor.getFullYear() + 1);
            if (cursor > end) break;
        }
        return segments;
    }

    get numYears() { return this._yearSegments.length; }

    // ── Mode classes / flags ──────────────────────────────────────────────
    get modeProRataClass(){ return 'calc-mode-tab' + (this.mode==='prorata'?' calc-mode-active':''); }
    get modeEqualClass()  { return 'calc-mode-tab' + (this.mode==='equal'  ?' calc-mode-active':''); }
    get modeCustomClass() { return 'calc-mode-tab' + (this.mode==='custom' ?' calc-mode-active':''); }
    get modePctClass()    { return 'calc-mode-tab' + (this.mode==='pct'    ?' calc-mode-active':''); }
    get isProRata() { return this.mode === 'prorata'; }
    get isEqual()   { return this.mode === 'equal'; }
    get isCustom()  { return this.mode === 'custom'; }
    get isPct()     { return this.mode === 'pct'; }

    // ── Computed ACVs per mode ────────────────────────────────────────────
    get computedACVs() {
        const segs = this._yearSegments;
        const n    = segs.length;
        const tcv  = this.tcv || 0;

        if (this.mode === 'prorata') {
            const total = this._totalDays;
            // Distribute proportionally by days; last year gets remainder to avoid rounding drift
            const acvs = segs.map(s => Math.round(tcv * s.days / total));
            // Fix rounding: add remainder to last year
            const sumSoFar = acvs.reduce((a, b) => a + b, 0);
            acvs[n - 1] += (tcv - sumSoFar);
            return acvs;
        }
        if (this.mode === 'equal') {
            const each = Math.round(tcv / n);
            const acvs = Array.from({ length: n }, () => each);
            acvs[n - 1] += (tcv - each * n); // remainder to last
            return acvs;
        }
        if (this.mode === 'custom') {
            return Array.from({ length: n }, (_, i) => Number(this.customACVs[i]) || 0);
        }
        // pct
        const acvs = Array.from({ length: n }, (_, i) => Math.round(tcv * (Number(this.pcts[i]) || 0) / 100));
        const sumSoFar = acvs.reduce((a, b) => a + b, 0);
        acvs[n - 1] += (tcv - sumSoFar);
        return acvs;
    }

    // ── Year rows for display ─────────────────────────────────────────────
    get yearRows() {
        const segs  = this._yearSegments;
        const total = this._totalDays;
        const acvs  = this.computedACVs;

        return segs.map((s, i) => {
            const pctOfTotal = total > 0 ? ((s.days / total) * 100).toFixed(1) : 0;
            const fmtDate = d => MONTH_NAMES[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
            const isPartial = s.days < 365;
            return {
                year:        i + 1,
                period:      fmtDate(s.start) + ' → ' + fmtDate(s.end),
                days:        fmtDays(s.days),
                pctOfTotal:  pctOfTotal + '%',
                isPartial,
                partialBadge:isPartial ? 'Partial year' : '',
                acvComputed: fmtUSD(acvs[i]),
                customACV:   this.customACVs[i] || null,
                pct:         this.pcts[i] || Math.round(100 / segs.length),
                pctACV:      fmtUSD(Math.round(this.tcv * (Number(this.pcts[i]) || 0) / 100)),
                rowClass:    'calc-year-row' + (isPartial ? ' calc-year-partial' : '')
            };
        });
    }

    // ── Summary ───────────────────────────────────────────────────────────
    get acvSum()        { return this.computedACVs.reduce((a, b) => a + b, 0); }
    get diff()          { return this.acvSum - (this.tcv || 0); }
    get isMatch()       { return this.tcv > 0 && Math.abs(this.diff) < 2; }
    get isNotMatch()    { return !this.isMatch; }
    get tcvFormatted()  { return fmtUSD(this.tcv); }
    get totalDaysLabel(){ return fmtDays(this._totalDays); }
    get sumFormatted()  { return fmtUSD(this.acvSum); }
    get diffLabel()     {
        if (Math.abs(this.diff) < 2) return '✓ No difference';
        return (this.diff > 0 ? '+' : '') + fmtUSD(this.diff) + ' difference';
    }
    get sumClass()  { return 'calc-sum-val ' + (this.isMatch ? 'calc-ok' : 'calc-warn'); }
    get diffClass() { return 'calc-sum-val ' + (this.isMatch ? 'calc-ok' : 'calc-warn'); }

    // Contract period label
    get contractPeriodLabel() {
        if (!this.startDate || !this.endDate) return '';
        const fmtD = d => MONTH_NAMES[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear();
        return fmtD(this._startDt) + ' → ' + fmtD(this._endDt);
    }

    // ── Handlers ──────────────────────────────────────────────────────────
    handleTCVChange(e) {
        this.tcv = Number(e.target.value) || 0;
    }

    handleModeChange(e) {
        this.mode = e.currentTarget.dataset.mode;
        // Pre-fill custom with current pro-rata values as starting point
        if (this.mode === 'custom' && this.customACVs.every(v => !v)) {
            const proRataACVs = this._getProRataACVs();
            this.customACVs  = [...proRataACVs];
        }
    }

    _getProRataACVs() {
        const segs  = this._yearSegments;
        const total = this._totalDays;
        const tcv   = this.tcv || 0;
        const acvs  = segs.map(s => Math.round(tcv * s.days / total));
        const sum   = acvs.reduce((a, b) => a + b, 0);
        acvs[acvs.length - 1] += (tcv - sum);
        return acvs;
    }

    handleCustomACVChange(e) {
        const yr  = parseInt(e.target.dataset.year, 10) - 1;
        const val = Number(e.target.value) || null;
        const upd = [...this.customACVs];
        upd[yr]   = val;
        this.customACVs = upd;
    }

    handlePctChange(e) {
        const yr  = parseInt(e.target.dataset.year, 10) - 1;
        const val = Number(e.target.value) || 0;
        const upd = [...this.pcts];
        upd[yr]   = val;
        this.pcts = upd;
    }

    handleReset() {
        this.tcv  = Number(this.initialTCV) || 0;
        this.mode = 'prorata';
        this._reset();
    }

    handleApply() {
        this.dispatchEvent(new CustomEvent('applycalc', {
            detail: {
                tcv:        this.tcv,
                years:      this.numYears,
                yearlyACVs: this.computedACVs
            }
        }));
    }

    handleClose() {
        this.dispatchEvent(new CustomEvent('closecalc'));
    }

    @api closeOnSave() {
        this.dispatchEvent(new CustomEvent('closecalc'));
    }
}

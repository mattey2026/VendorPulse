import { LightningElement, track, wire } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import { refreshApex } from '@salesforce/apex';
import getRenewals         from '@salesforce/apex/OMP_RenewalController.getRenewals';
import getDashboardMetrics from '@salesforce/apex/OMP_RenewalController.getDashboardMetrics';
import getClosureLog       from '@salesforce/apex/OMP_RenewalController.getClosureLog';
import saveRenewal         from '@salesforce/apex/OMP_RenewalController.saveRenewal';
import saveAndSplit        from '@salesforce/apex/OMP_RenewalController.saveAndSplit';

const EMPTY_FORM = {
    OEM__c:'', Vendor_Name__c:'', Description__c:'', PO_Number__c:'',
    Category__c:'IT&T', Currency__c:'INR', PO_Amount__c:null,
    ACV_USD__c:null, Last_Year_ACV_USD__c:null, Duration_Years__c:1,
    Start_Date__c:'', End_Date__c:'', Hygiene_Status__c:'Identified', Closure_Date__c:''
};

// Default column order
const DEFAULT_COLS = [
    { key:'oem',    field:'OEM__c',             label:'OEM',        isOEM:true },
    { key:'vendor', field:'Vendor_Name__c',      label:'Vendor',     isVendor:true },
    { key:'desc',   field:'Description__c',      label:'Description',isDesc:true },
    { key:'po',     field:'PO_Number__c',        label:'PO number',  isPO:true },
    { key:'cat',    field:'Category__c',         label:'Category',   isCat:true },
    { key:'cur',    field:'Currency__c',         label:'Currency',   isCur:true },
    { key:'poamt',  field:'PO_Amount__c',        label:'PO amount',  isPOAmt:true },
    { key:'acv',    field:'ACV_USD__c',          label:'ACV (USD)',  isACV:true },
    { key:'end',    field:'End_Date__c',         label:'End date',   isEnd:true },
    { key:'days',   field:'Days_To_Renewal__c',  label:'Days',       isDays:true },
    { key:'status', field:'Hygiene_Status__c',   label:'Status',     isStatus:true }
];

const SORTABLE = ['OEM__c','Vendor_Name__c','Description__c','PO_Number__c',
    'Category__c','PO_Amount__c','ACV_USD__c','End_Date__c','Days_To_Renewal__c','Hygiene_Status__c'];

const GENPACT_QUARTERS = [
    { q:'Q1', months:[3,4,5],   label:'Q1 Apr–Jun', shortLabel:'Q1' },
    { q:'Q2', months:[6,7,8],   label:'Q2 Jul–Sep', shortLabel:'Q2' },
    { q:'Q3', months:[9,10,11], label:'Q3 Oct–Dec', shortLabel:'Q3' },
    { q:'Q4', months:[0,1,2],   label:'Q4 Jan–Mar', shortLabel:'Q4' }
];

function genpactFY(date) {
    const m=date.getMonth(), y=date.getFullYear();
    return m>=3 ? `FY ${y}-${String(y+1).slice(2)}` : `FY ${y-1}-${String(y).slice(2)}`;
}
function genpactQtr(date) {
    const m=date.getMonth();
    for (const q of GENPACT_QUARTERS) { if(q.months.includes(m)) return q.q; }
    return 'Q1';
}
function fmtM(n) {
    if(n==null||n===0) return '—';
    if(Math.abs(n)>=1000000) return '$'+(n/1000000).toFixed(1)+'M';
    if(Math.abs(n)>=1000)    return '$'+(n/1000).toFixed(0)+'K';
    return '$'+n.toLocaleString('en-US',{maximumFractionDigits:0});
}

export default class OmpRenewalTracker extends LightningElement {
    @track activeTab       = 'tracker';
    @track showGuide       = false;
    @track showImport      = false;
    @track showAlertBanner = true;
    @track isLoading       = false;
    @track showModal       = false;
    @track showSplitModal  = false;
    @track showCalculator  = false;
    @track showCsvImporter = false;
    @track selectedId      = null;
    @track isNewRenewal    = false;
    @track isSaving        = false;
    @track form            = Object.assign({}, EMPTY_FORM);
    @track splitForm       = null;
    @track splitYearACVs   = [];
    @track _allRecords     = [];
    @track closureLog      = [];
    @track metrics         = {totalRenewals:0,overdueCount:0,criticalCount:0,inProgressCount:0,closedYTD:0,totalACV:0};
    @track globalSearch    = '';
    @track filterCategory  = '';
    @track filterStatus    = '';
    @track sortCol         = 'Days_To_Renewal__c';
    @track sortDir         = 'asc';
    @track currentPage     = 1;
    @track pageSize        = 10;
    @track selectedFY      = '';
    @track selectedQtr     = '';
    // draggable columns
    @track colOrder        = DEFAULT_COLS.map(c=>c.key);
    @track dragSrcIdx      = null;

    _wiredRenewals; _wiredMetrics; _wiredClosure;

    @wire(getRenewals, {category:'',hygieneStatus:'',searchTerm:'',buyerId:''})
    wiredRenewals(result) {
        this._wiredRenewals=result;
        if(result.data) this._allRecords=result.data.map(w=>this.enrich(w));
        if(result.error) console.error('wiredRenewals',JSON.stringify(result.error));
        this.isLoading=false;
    }
    @wire(getDashboardMetrics) wiredMetrics(r){this._wiredMetrics=r;if(r.data)this.metrics=r.data;}
    @wire(getClosureLog)       wiredClosure(r){this._wiredClosure=r;if(r.data)this.closureLog=r.data.map(w=>this.enrich(w));}

    // ── COLUMN DRAG & DROP ────────────────────────────────────────────────
    get columnDefs() {
        const sortable = SORTABLE;
        return this.colOrder.map((key,idx) => {
            const def = DEFAULT_COLS.find(c=>c.key===key);
            if(!def) return null;
            const isSortActive = this.sortCol===def.field;
            const arrow = isSortActive ? (this.sortDir==='asc'?'↑':'↓') : '';
            return {
                ...def, idx,
                sortArrow: arrow,
                thClass: 'vp-th vp-th-drag-handle'+(sortable.includes(def.field)?' vp-th-sortable':'')+(isSortActive?' vp-th-active':''),
                tdClass: ['poamt','acv'].includes(key)?'vp-td-right':''
            };
        }).filter(Boolean);
    }

    handleDragStart(e) {
        this.dragSrcIdx = parseInt(e.currentTarget.dataset.idx, 10);
        e.dataTransfer.effectAllowed = 'move';
    }
    handleDragOver(e) { e.preventDefault(); e.dataTransfer.dropEffect='move'; }
    handleDrop(e) {
        e.preventDefault();
        const targetIdx = parseInt(e.currentTarget.dataset.idx, 10);
        if(this.dragSrcIdx === null || this.dragSrcIdx === targetIdx) return;
        const newOrder = [...this.colOrder];
        const [moved] = newOrder.splice(this.dragSrcIdx, 1);
        newOrder.splice(targetIdx, 0, moved);
        this.colOrder = newOrder;
        this.dragSrcIdx = null;
    }
    handleDragEnd() { this.dragSrcIdx = null; }
    resetColumns()   { this.colOrder = DEFAULT_COLS.map(c=>c.key); }

    // ── FILTER / SORT / PAGE ──────────────────────────────────────────────
    get filteredRecords() {
        let recs = this._allRecords;
        if(this.globalSearch){
            const s=this.globalSearch.toLowerCase();
            recs=recs.filter(w=>{
                if(!w?.record) return false;
                const r=w.record;
                return [r.OEM__c,r.Vendor_Name__c,r.Description__c,r.PO_Number__c,r.Category__c,r.Hygiene_Status__c]
                    .some(v=>v&&String(v).toLowerCase().includes(s));
            });
        }
        if(this.filterCategory) recs=recs.filter(w=>w.record?.Category__c===this.filterCategory);
        if(this.filterStatus)   recs=recs.filter(w=>w.record?.Hygiene_Status__c===this.filterStatus);
        return recs;
    }
    get sortedRecords() {
        const recs=[...this.filteredRecords];
        if(!this.sortCol) return recs;
        const dir=this.sortDir==='asc'?1:-1, col=this.sortCol;
        return recs.sort((a,b)=>{
            let va=a.record?.[col]??'', vb=b.record?.[col]??'';
            if(['ACV_USD__c','PO_Amount__c','Days_To_Renewal__c'].includes(col)){va=Number(va)||0;vb=Number(vb)||0;return(va-vb)*dir;}
            if(col==='End_Date__c'){va=va?new Date(va).getTime():0;vb=vb?new Date(vb).getTime():0;return(va-vb)*dir;}
            return String(va).toLowerCase().localeCompare(String(vb).toLowerCase())*dir;
        });
    }
    handleSort(e) {
        const col=e.currentTarget.dataset.col;
        if(!col||!SORTABLE.includes(col)) return;
        if(this.sortCol===col){this.sortDir=this.sortDir==='asc'?'desc':'asc';}
        else{this.sortCol=col;this.sortDir='asc';}
        this.currentPage=1;
    }
    get filteredCount()     {return this.filteredRecords.length;}
    get filteredCountLabel(){return this.filteredCount===1?'':'s';}
    get totalPages()        {return Math.max(1,Math.ceil(this.filteredCount/this.pageSize));}
    get pageRecords()       {const s=(this.currentPage-1)*this.pageSize;return this.sortedRecords.slice(s,s+this.pageSize);}
    get hasPageRecords()    {return this.pageRecords.length>0;}
    get isFirstPage()       {return this.currentPage<=1;}
    get isLastPage()        {return this.currentPage>=this.totalPages;}
    get ps10(){return this.pageSize===10;} get ps20(){return this.pageSize===20;}
    get ps30(){return this.pageSize===30;} get ps50(){return this.pageSize===50;}
    get paginationInfo()    {const s=Math.min((this.currentPage-1)*this.pageSize+1,this.filteredCount),e=Math.min(this.currentPage*this.pageSize,this.filteredCount);return`${s}–${e} of ${this.filteredCount}`;}
    goFirst(){this.currentPage=1;} goPrev(){if(!this.isFirstPage)this.currentPage--;}
    goNext(){if(!this.isLastPage)this.currentPage++;} goLast(){this.currentPage=this.totalPages;}
    handlePageSizeChange(e){this.pageSize=Number(e.target.value);this.currentPage=1;}
    handlePageJump(e){let p=parseInt(e.target.value,10);if(isNaN(p))return;this.currentPage=Math.max(1,Math.min(p,this.totalPages));e.target.value=this.currentPage;}
    handleGlobalSearch(e)  {this.globalSearch=e.target.value;this.currentPage=1;}
    handleCategoryFilter(e){this.filterCategory=e.detail.value;this.currentPage=1;}
    handleStatusFilter(e)  {this.filterStatus=e.detail.value;this.currentPage=1;}
    get hasSortOrFilter()  {return this.globalSearch||this.filterCategory||this.filterStatus;}
    clearAll(){this.globalSearch='';this.filterCategory='';this.filterStatus='';this.sortCol='Days_To_Renewal__c';this.sortDir='asc';this.currentPage=1;}

    // ── QUARTERLY / FY ────────────────────────────────────────────────────
    get fyOptions() {
        const today=new Date(), curFY=genpactFY(today);
        const fys=[...new Set(this._allRecords.filter(w=>w.record?.End_Date__c).map(w=>genpactFY(new Date(w.record.End_Date__c+'T00:00:00'))))].sort();
        if(!fys.includes(curFY)) fys.unshift(curFY);
        return fys.map(fy=>({value:fy,label:fy,cls:'vp-fy-chip'+(this.selectedFY===fy?' vp-fy-chip--active':'')}));
    }
    get qtrOptions(){return GENPACT_QUARTERS.map(q=>({value:q.q,label:q.label,cls:'vp-fy-chip'+(this.selectedQtr===q.q?' vp-fy-chip--active':'')}));}
    get hasQtrFilter(){return this.selectedFY||this.selectedQtr;}
    get qtrFilteredRecords(){
        return this._allRecords.filter(w=>{
            if(!w.record?.End_Date__c) return false;
            const d=new Date(w.record.End_Date__c+'T00:00:00');
            if(this.selectedFY&&genpactFY(d)!==this.selectedFY) return false;
            if(this.selectedQtr&&genpactQtr(d)!==this.selectedQtr) return false;
            return true;
        });
    }
    get qtrGroupedRecords(){
        const groups={};
        this.qtrFilteredRecords.forEach(w=>{
            if(!w.record?.End_Date__c) return;
            const d=new Date(w.record.End_Date__c+'T00:00:00'),fy=genpactFY(d),q=genpactQtr(d),key=fy+'|'+q;
            if(!groups[key]){const qi=GENPACT_QUARTERS.find(x=>x.q===q);groups[key]={key,label:`${qi?.label||q} · ${fy}`,records:[],acv:0,headerClass:'vp-qtr-grp-header'};}
            groups[key].records.push(w);
            groups[key].acv+=(w.record.ACV_USD__c||0);
        });
        return Object.values(groups).sort((a,b)=>a.key.localeCompare(b.key)).map(g=>({...g,count:g.records.length,countLabel:g.records.length===1?'':'s',acvFormatted:fmtM(g.acv)}));
    }
    get hasQtrRecords(){return this.qtrFilteredRecords.length>0;}
    get qtrSummaryCards(){
        const recs=this.selectedFY?this._allRecords.filter(w=>{if(!w.record?.End_Date__c)return false;return genpactFY(new Date(w.record.End_Date__c+'T00:00:00'))===this.selectedFY;}):this._allRecords.filter(w=>w.record?.End_Date__c);
        return GENPACT_QUARTERS.map(q=>{
            const qRecs=recs.filter(w=>{if(!w.record?.End_Date__c)return false;return genpactQtr(new Date(w.record.End_Date__c+'T00:00:00'))===q.q;});
            const acv=qRecs.reduce((s,w)=>s+(w.record.ACV_USD__c||0),0);
            const hasOverdue=qRecs.some(w=>w.urgencyLevel==='OVERDUE'||w.urgencyLevel==='CRITICAL');
            return {qtr:q.q,label:q.label,dates:q.q==='Q1'?'Apr–Jun':q.q==='Q2'?'Jul–Sep':q.q==='Q3'?'Oct–Dec':'Jan–Mar',count:qRecs.length,countLabel:qRecs.length===1?'':'s',acvFormatted:fmtM(acv),cardClass:'vp-qtr-card'+(this.selectedQtr===q.q?' vp-qtr-card--active':hasOverdue?' vp-qtr-card--danger':'')};
        });
    }
    handleFYSelect(e){const v=e.target.dataset.value;this.selectedFY=this.selectedFY===v?'':v;}
    handleQtrSelect(e){const v=e.target.dataset.value;this.selectedQtr=this.selectedQtr===v?'':v;}
    clearQtrFilters(){this.selectedFY='';this.selectedQtr='';}

    // ── DASHBOARD CHARTS ──────────────────────────────────────────────────
    get monthlyExpiryData(){
        const today=new Date(),MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
        let maxCount=0;
        const months=[];
        for(let i=0;i<12;i++){
            const d=new Date(today.getFullYear(),today.getMonth()+i,1);
            const mRecs=this._allRecords.filter(w=>{if(!w.record?.End_Date__c)return false;const ed=new Date(w.record.End_Date__c+'T00:00:00');return ed.getMonth()===d.getMonth()&&ed.getFullYear()===d.getFullYear();});
            const count=mRecs.length, acv=mRecs.reduce((s,w)=>s+(w.record.ACV_USD__c||0),0);
            const oems=mRecs.map(w=>w.record.OEM__c).filter(Boolean).join(', ')||'—';
            if(count>maxCount) maxCount=count;
            months.push({month:MONTHS[d.getMonth()]+' '+String(d.getFullYear()).slice(2),shortMonth:MONTHS[d.getMonth()],count,acv,acvFormatted:fmtM(acv),oemList:oems,countLabel:count>0?String(count):'',barClass:'vp-month-bar'+(count===0?' vp-bar-empty':i<2?' vp-bar-danger':i<4?' vp-bar-warn':' vp-bar-ok')});
        }
        const mx=maxCount||1;
        return months.map(m=>({...m,barStyle:`height:${Math.max(4,Math.round((m.count/mx)*80))}px`}));
    }

    get statusChartData(){
        const statuses=['Identified','Engaged','Approval','PR Created'];
        const totalACV=this._allRecords.reduce((s,w)=>s+(w.record?.ACV_USD__c||0),0)||1;
        const colors={'Identified':'#706e6b','Engaged':'#0176d3','Approval':'#dd7a01','PR Created':'#2e844a'};
        const badges={'Identified':'vp-status vp-status--grey','Engaged':'vp-status vp-status--blue','Approval':'vp-status vp-status--warning','PR Created':'vp-status vp-status--success'};
        const maxACV=Math.max(...statuses.map(s=>this._allRecords.filter(w=>w.record?.Hygiene_Status__c===s).reduce((a,w)=>a+(w.record.ACV_USD__c||0),0)),1);
        return statuses.map(s=>{
            const recs=this._allRecords.filter(w=>w.record?.Hygiene_Status__c===s);
            const acv=recs.reduce((a,w)=>a+(w.record.ACV_USD__c||0),0);
            return {status:s,count:recs.length,acvFormatted:fmtM(acv),badge:badges[s]||'vp-status',pct:totalACV>0?Math.round((acv/totalACV)*100):0,barStyle:`width:${Math.round((acv/maxACV)*100)}%;background:${colors[s]};height:10px;border-radius:4px`};
        });
    }

    get oemChartData(){
        const map={},countMap={};
        this._allRecords.forEach(w=>{if(!w?.record)return;const k=w.record.OEM__c||'Other';map[k]=(map[k]||0)+(w.record.ACV_USD__c||0);countMap[k]=(countMap[k]||0)+1;});
        const total=Object.values(map).reduce((s,v)=>s+v,0)||1;
        const mx=Math.max(...Object.values(map),1);
        return Object.entries(map).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([oem,v])=>({oem,acvFormatted:fmtM(v),count:countMap[oem]||0,pct:Math.round((v/total)*100),barStyle:`width:${Math.round((v/mx)*100)}%;background:#0176d3;height:10px;border-radius:4px`}));
    }

    get categoryChartData(){
        const map={},countMap={};
        this._allRecords.forEach(w=>{if(!w?.record)return;const k=w.record.Category__c||'Other';map[k]=(map[k]||0)+(w.record.ACV_USD__c||0);countMap[k]=(countMap[k]||0)+1;});
        const total=Object.values(map).reduce((s,v)=>s+v,0)||1;
        const mx=Math.max(...Object.values(map),1);
        const cols={'IT&T':'#0176d3','License':'#7b5ccc','AMC':'#dd7a01','Services':'#2e844a'};
        return Object.entries(map).sort((a,b)=>b[1]-a[1]).map(([category,v])=>({category,acvFormatted:fmtM(v),count:countMap[category]||0,pct:Math.round((v/total)*100),catBarStyle:`width:${Math.round((v/mx)*100)}%;background:${cols[category]||'#0176d3'};height:10px;border-radius:4px`}));
    }

    get urgencyChartData(){
        const levels=[{level:'OVERDUE',label:'Overdue',color:'#c23934'},{level:'CRITICAL',label:'Critical (0–14d)',color:'#c23934'},{level:'URGENT',label:'Urgent (15–30d)',color:'#dd7a01'},{level:'WARNING',label:'Warning (31–90d)',color:'#f0a500'},{level:'OK',label:'On track (90d+)',color:'#2e844a'}];
        const mx=Math.max(...levels.map(l=>this._allRecords.filter(w=>w.urgencyLevel===l.level).length),1);
        return levels.map(l=>{
            const recs=this._allRecords.filter(w=>w.urgencyLevel===l.level);
            const acv=recs.reduce((s,w)=>s+(w.record?.ACV_USD__c||0),0);
            return {...l,count:recs.length,acvFormatted:fmtM(acv),dotClass:'vp-urgency-dot',barStyle:`width:${Math.round((recs.length/mx)*100)}%;background:${l.color};height:10px;border-radius:4px`};
        });
    }

    // YoY with up to 3 years — uses duration and split records to detect year 2 & 3
    get yoyChartData(){
        // Group by OEM, collect acv per year based on Due_Year__c
        const map={};
        this._allRecords.forEach(w=>{
            if(!w?.record||!w.record.OEM__c) return;
            const k=w.record.OEM__c;
            if(!map[k]) map[k]={curr:0,y1:0,y2:0,currYear:new Date().getFullYear()};
            const dueYear=w.record.Due_Year__c||new Date(w.record.End_Date__c+'T00:00:00').getFullYear();
            const thisYear=new Date().getFullYear();
            const acv=w.record.ACV_USD__c||0;
            if(dueYear===thisYear)       map[k].curr+=acv;
            else if(dueYear===thisYear-1) map[k].y1+=w.record.Last_Year_ACV_USD__c||acv;
            else if(dueYear===thisYear-2) map[k].y2+=acv;
            // also use Last_Year_ACV_USD__c if curr record has it
            if(dueYear===thisYear&&w.record.Last_Year_ACV_USD__c) map[k].y1=Math.max(map[k].y1,w.record.Last_Year_ACV_USD__c);
        });
        const mx=Math.max(...Object.values(map).flatMap(v=>[v.curr,v.y1,v.y2]),1);
        return Object.entries(map).filter(([,v])=>v.curr>0).sort((a,b)=>b[1].curr-a[1].curr).slice(0,7).map(([oem,v])=>{
            const diff=v.curr-(v.y1||v.curr);
            return {
                oem, hasY2:v.y2>0, hasY1:v.y1>0,
                y2Formatted:fmtM(v.y2), y1Formatted:fmtM(v.y1), currFormatted:fmtM(v.curr),
                y2BarStyle:`height:${Math.max(4,Math.round((v.y2/mx)*60))}px;background:#d0d5dd`,
                y1BarStyle:`height:${Math.max(4,Math.round((v.y1/mx)*60))}px;background:#93c5fd`,
                currBarStyle:`height:${Math.max(4,Math.round((v.curr/mx)*60))}px;background:#0176d3`,
                variance:v.y1>0?(diff>=0?'+':'')+fmtM(diff):'New',
                varClass:'vp-yoy-var '+(v.y1===0?'vp-yoy-new':diff>0?'vp-yoy-up':diff<0?'vp-yoy-down':'')
            };
        });
    }

    get topActionRecords(){
        return [...this._allRecords].filter(w=>['OVERDUE','CRITICAL','URGENT','WARNING'].includes(w.urgencyLevel)).sort((a,b)=>(a.record.Days_To_Renewal__c||999)-(b.record.Days_To_Renewal__c||999)).slice(0,5);
    }

    // Health score widget
    get healthScore(){
        const total=this._allRecords.length||1;
        const bad=this._allRecords.filter(w=>['OVERDUE','CRITICAL','URGENT'].includes(w.urgencyLevel)).length;
        return Math.round(((total-bad)/total)*100);
    }
    get healthRingStyle(){
        const score=this.healthScore;
        const color=score>=80?'#2e844a':score>=60?'#dd7a01':'#c23934';
        return `background:conic-gradient(${color} ${score*3.6}deg, #e5e5e5 0deg)`;
    }
    get onTrackCount(){return this._allRecords.filter(w=>w.urgencyLevel==='OK').length;}
    get warningCount(){return this._allRecords.filter(w=>w.urgencyLevel==='WARNING').length;}
    get criticalTotalCount(){return this._allRecords.filter(w=>['OVERDUE','CRITICAL','URGENT'].includes(w.urgencyLevel)).length;}

    // Savings summary
    get savingsSummary(){
        return this._allRecords.filter(w=>w.record?.ACV_USD__c&&w.record?.Last_Year_ACV_USD__c&&w.record.Last_Year_ACV_USD__c>0).map(w=>{
            const diff=w.record.ACV_USD__c-w.record.Last_Year_ACV_USD__c;
            return {oem:w.record.OEM__c,variance:(diff>=0?'+':'')+fmtM(diff),note:diff<0?'Savings achieved':diff>0?'Cost increase':'No change',varClass:'vp-savings-var '+(diff<0?'vp-savings-down':diff>0?'vp-savings-up':'')};
        }).sort((a,b)=>a.variance.localeCompare(b.variance)).slice(0,6);
    }

    // Quarter mini chart (all FYs combined)
    get qtrMiniData(){
        const mx=Math.max(...GENPACT_QUARTERS.map(q=>{return this._allRecords.filter(w=>{if(!w.record?.End_Date__c)return false;return genpactQtr(new Date(w.record.End_Date__c+'T00:00:00'))===q.q;}).length;}),1);
        return GENPACT_QUARTERS.map(q=>{
            const recs=this._allRecords.filter(w=>{if(!w.record?.End_Date__c)return false;return genpactQtr(new Date(w.record.End_Date__c+'T00:00:00'))===q.q;});
            const acv=recs.reduce((s,w)=>s+(w.record.ACV_USD__c||0),0);
            return {qtr:q.q,label:q.label,count:recs.length,acvFormatted:fmtM(acv),acvShort:acv>0?fmtM(acv):'—',barStyle:`height:${Math.max(6,Math.round((recs.length/mx)*60))}px;background:#0176d3;border-radius:4px 4px 0 0`};
        });
    }

    // ── SPLIT ─────────────────────────────────────────────────────────────
    get splitYears()          {return this.splitYearACVs.length;}
    get splitDurationLabel()  {return this.splitYears+'-year contract';}
    get splitTCVFormatted()   {const t=this.splitForm?.Estimated_PO_TCV_USD__c||this.splitForm?.PO_Amount__c||0;return fmtM(t);}
    get splitACVTotal()       {return this.splitYearACVs.reduce((s,v)=>s+(Number(v)||0),0);}
    get splitACVTotalFormatted(){return fmtM(this.splitACVTotal);}
    get splitTotalWarning()   {const t=Number(this.splitForm?.Estimated_PO_TCV_USD__c||this.splitForm?.PO_Amount__c||0);if(!t||!this.splitACVTotal)return'';return Math.abs(this.splitACVTotal-t)>1000?'⚠ Does not match TCV':'✓ Matches TCV';}
    get splitTotalClass()     {const t=Number(this.splitForm?.Estimated_PO_TCV_USD__c||this.splitForm?.PO_Amount__c||0);if(!t)return'vp-split-total-val';return'vp-split-total-val '+(Math.abs(this.splitACVTotal-t)>1000?'vp-danger-text':'vp-success-text');}
    get splitYearRows(){
        if(!this.splitForm) return [];
        const rows=[],start=new Date(this.splitForm.Start_Date__c+'T00:00:00'),today=new Date();
        for(let i=0;i<this.splitYears;i++){
            const ys=new Date(start);ys.setFullYear(ys.getFullYear()+i);
            const ye=new Date(start);ye.setFullYear(ye.getFullYear()+i+1);ye.setDate(ye.getDate()-1);
            const isCurrent=today>=ys&&today<=ye;
            const fmtD=d=>d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
            rows.push({year:i,yearLabel:'Year '+(i+1),startDate:fmtD(ys),endDate:fmtD(ye),acv:this.splitYearACVs[i]||null,isCurrent,rowClass:'vp-split-year-row'+(isCurrent?' vp-split-year-current':''),badgeClass:'vp-split-year-badge'+(isCurrent?' vp-split-badge-active':'')});
        }
        return rows;
    }

    // ── BASICS ────────────────────────────────────────────────────────────
    get todayLabel()       {return new Date().toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});}
    get currentYear()      {return new Date().getFullYear();}
    get hasOverdue()       {return this.showAlertBanner&&this.metrics.overdueCount>0;}
    get overdueLabel()     {return this.metrics.overdueCount===1?'':'s';}
    get totalACVFormatted(){return fmtM(this.metrics.totalACV||0);}
    get isTracker()        {return this.activeTab==='tracker';}
    get isQtr()            {return this.activeTab==='qtr';}
    get isDashboard()      {return this.activeTab==='dashboard';}
    get isHygiene()        {return this.activeTab==='hygiene';}
    get isClosure()        {return this.activeTab==='closure';}
    get tabTrackerClass()  {return 'vp-tab'+(this.activeTab==='tracker'  ?' vp-tab--active':'');}
    get tabQtrClass()      {return 'vp-tab'+(this.activeTab==='qtr'      ?' vp-tab--active':'');}
    get tabDashboardClass(){return 'vp-tab'+(this.activeTab==='dashboard'?' vp-tab--active':'');}
    get tabHygieneClass()  {return 'vp-tab'+(this.activeTab==='hygiene'  ?' vp-tab--active':'');}
    get tabClosureClass()  {return 'vp-tab'+(this.activeTab==='closure'  ?' vp-tab--active':'');}
    get hasClosureLog()    {return this.closureLog.length>0;}
    get modalTitle()       {return this.isNewRenewal?'Add renewal':'Edit renewal — '+(this.form.OEM__c||'');}
    get saveLabel()        {return this.isSaving?'Saving...':(this.isNewRenewal?'Add to tracker':'Save changes');}
    get showYoY()          {return this.form.ACV_USD__c&&this.form.Last_Year_ACV_USD__c&&Number(this.form.Last_Year_ACV_USD__c)>0;}
    get yoyVariance()      {if(!this.showYoY)return'';const d=Number(this.form.ACV_USD__c)-Number(this.form.Last_Year_ACV_USD__c);return(d>=0?'+':'')+' '+fmtM(d);}
    get yoyClass()         {if(!this.showYoY)return'vp-yoy-panel-val';return'vp-yoy-panel-val '+(Number(this.form.ACV_USD__c)>Number(this.form.Last_Year_ACV_USD__c)?'vp-danger-text':'vp-success-text');}
    get categoryOptions()  {return [{label:'All categories',value:''},{label:'IT&T',value:'IT&T'},{label:'License',value:'License'},{label:'AMC',value:'AMC'},{label:'Services',value:'Services'}];}
    get statusOptions()    {return [{label:'All statuses',value:''},{label:'Identified',value:'Identified'},{label:'Engaged',value:'Engaged'},{label:'Approval',value:'Approval'},{label:'PR Created',value:'PR Created'}];}
    get statusAllOptions() {return [{label:'Identified',value:'Identified'},{label:'Engaged',value:'Engaged'},{label:'Approval',value:'Approval'},{label:'PR Created',value:'PR Created'},{label:'Closed',value:'Closed'}];}
    get currencyOptions()  {return [{label:'INR',value:'INR'},{label:'USD',value:'USD'},{label:'EUR',value:'EUR'},{label:'GBP',value:'GBP'}];}

    // ── ENRICH ────────────────────────────────────────────────────────────
    enrich(w){
        try{
            if(!w?.record) return w||{};
            const r=w.record,urg=w.urgencyLevel||'OK',days=r.Days_To_Renewal__c;
            const isOver=urg==='OVERDUE'||urg==='CRITICAL';
            const fmt=n=>n!=null?'$'+Number(n).toLocaleString('en-US',{maximumFractionDigits:0}):'—';
            const fmtL=(n,c)=>{if(n==null)return'—';const s=c==='INR'?'₹':c==='EUR'?'€':c==='GBP'?'£':'$';return s+Number(n).toLocaleString('en-US',{maximumFractionDigits:0});};
            const fmtD=d=>d?new Date(d+'T00:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}):'—';
            const vc=!w.acvVariance?'vp-variance':w.acvVariance.startsWith('+')?'vp-variance vp-variance--up':'vp-variance vp-variance--down';
            const sm={'Identified':'vp-status vp-status--grey','Engaged':'vp-status vp-status--blue','Approval':'vp-status vp-status--warning','PR Created':'vp-status vp-status--success','Closed':'vp-status vp-status--closed'};
            const cm={'IT&T':'vp-cat vp-cat--blue','License':'vp-cat vp-cat--purple','AMC':'vp-cat vp-cat--amber','Services':'vp-cat vp-cat--green'};
            let al='View',av='neutral';
            if(urg==='OVERDUE'){al='Renew now';av='destructive';}
            else if(urg==='CRITICAL'){al='Start renewal';av='brand';}
            else if(urg==='URGENT'){al='Action needed';av='brand';}
            return{...w,rowClass:'vp-row'+(isOver?' vp-row--danger':urg==='URGENT'?' vp-row--warning':''),daysLabel:days!=null?String(days):'—',daysBadgeClass:'vp-days'+(isOver?' vp-days--danger':urg==='URGENT'?' vp-days--warning':urg==='WARNING'?' vp-days--warn2':' vp-days--ok'),statusBadgeClass:sm[r.Hygiene_Status__c]||'vp-status',categoryBadgeClass:cm[r.Category__c]||'vp-cat',actionLabel:al,actionVariant:av,varianceClass:vc,acvFormatted:fmt(r.ACV_USD__c),lastYearACVFormatted:fmt(r.Last_Year_ACV_USD__c),poAmountFormatted:fmtL(r.PO_Amount__c,r.Currency__c),endDateFormatted:fmtD(r.End_Date__c),closureDateFormatted:fmtD(r.Closure_Date__c),endDateClass:isOver?'vp-td-danger vp-td-bold':urg==='URGENT'?'vp-td-warning vp-td-bold':'vp-td-muted'};
        }catch(e){console.error('enrich',e);return w||{};}
    }

    // ── HANDLERS ──────────────────────────────────────────────────────────
    switchToTracker()  {this.activeTab='tracker';}
    switchToQtr()      {this.activeTab='qtr';}
    switchToDashboard(){this.activeTab='dashboard';}
    switchToHygiene()  {this.activeTab='hygiene';}
    switchToClosure()  {this.activeTab='closure';}
    dismissAlert()     {this.showAlertBanner=false;}
    toggleGuide()      {this.showGuide=!this.showGuide;this.showImport=false;}
    toggleImport()     {this.showImport=!this.showImport;this.showGuide=false;}
    stopProp(e)        {e.stopPropagation();}
    handleOverlayClick(){this.showModal=false;}
    handleModalClose() {this.showModal=false;}

    handleNewRenewal(){this.form=Object.assign({},EMPTY_FORM);this.selectedId=null;this.isNewRenewal=true;this.showModal=true;this.showGuide=false;this.showImport=false;}
    handleRowAction(e){
        const id=e.currentTarget.dataset.id;
        const found=this._allRecords.find(w=>w.record?.Id===id);
        if(found?.record){this.form=Object.assign({},EMPTY_FORM,found.record);this.selectedId=id;this.isNewRenewal=false;this.showModal=true;}
    }
    handleFormChange(e){
        const field=e.target.dataset.field,val=e.detail?e.detail.value:e.target.value;
        let updated=Object.assign({},this.form,{[field]:val});

        // Auto-calculate End Date whenever Start Date or Duration changes
        if((field==='Start_Date__c'||field==='Duration_Years__c') && updated.Start_Date__c && updated.Duration_Years__c){
            const dur=Number(updated.Duration_Years__c);
            if(dur>0){
                const start=new Date(updated.Start_Date__c+'T00:00:00');
                const end=new Date(start);
                end.setFullYear(end.getFullYear()+dur);
                end.setDate(end.getDate()-1);
                const pad=n=>String(n).padStart(2,'0');
                updated.End_Date__c=end.getFullYear()+'-'+pad(end.getMonth()+1)+'-'+pad(end.getDate());
            }
        }
        this.form=updated;
    }
    handleSave(){
        const inputs=[...this.template.querySelectorAll('lightning-input,lightning-combobox')];
        if(!inputs.reduce((ok,i)=>i.reportValidity()&&ok,true)) return;
        const rec=Object.assign({},this.form);
        if(!this.isNewRenewal&&this.selectedId) rec.Id=this.selectedId;
        Object.keys(rec).forEach(k=>{if(rec[k]==='')rec[k]=null;});
        const dur=Number(rec.Duration_Years__c)||1;
        if(this.isNewRenewal&&dur>1&&rec.Start_Date__c&&rec.End_Date__c){
            this.splitForm=rec;
            const tcv=Number(rec.Estimated_PO_TCV_USD__c||rec.PO_Amount__c||0);
            const perYear=tcv>0?Math.round(tcv/dur):null;
            this.splitYearACVs=Array.from({length:dur},()=>perYear);
            this.showModal=false;this.showSplitModal=true;return;
        }
        this.isSaving=true;
        saveRenewal({renewal:rec}).then(()=>{this.isSaving=false;this.showModal=false;this.toast('Success','Renewal saved.','success');return this._refresh();}).catch(err=>{this.isSaving=false;this.toast('Error',err.body?.message||'Save failed.','error');});
    }
    handleSplitACVChange(e){const yr=parseInt(e.target.dataset.year,10),val=Number(e.target.value)||null;const upd=[...this.splitYearACVs];upd[yr]=val;this.splitYearACVs=upd;}
    saveAsSplit(){ this.showCalculator = false;
        this.isSaving=true;
        const rec=Object.assign({},this.splitForm);Object.keys(rec).forEach(k=>{if(rec[k]==='')rec[k]=null;});
        saveAndSplit({baseRenewal:rec,yearlyACVs:this.splitYearACVs}).then(ids=>{this.isSaving=false;this.showSplitModal=false;this.toast('Success',`Split into ${ids.length} yearly records.`,'success');return this._refresh();}).catch(err=>{this.isSaving=false;this.toast('Error',err.body?.message||'Split failed.','error');});
    }
    saveAsSingle(){this.showCalculator = false; this.showSplitModal=false;this.isSaving=true;const rec=Object.assign({},this.splitForm);Object.keys(rec).forEach(k=>{if(rec[k]==='')rec[k]=null;});saveRenewal({renewal:rec}).then(()=>{this.isSaving=false;this.toast('Success','Saved as single record.','success');return this._refresh();}).catch(err=>{this.isSaving=false;this.toast('Error',err.body?.message||'Save failed.','error');});}
    cancelSplit(){this.showSplitModal=false;this.showModal=true;}
    _refresh(){return Promise.all([refreshApex(this._wiredRenewals),refreshApex(this._wiredMetrics),refreshApex(this._wiredClosure)]);}
    handleRefresh(){this.isLoading=true;this._refresh().then(()=>{this.isLoading=false;});}

    exportToCSV(){
        const headers=['Name','OEM','Vendor','Description','PO Number','Category','Currency','PO Amount','ACV USD','Last Year ACV','Start Date','End Date','Days','Status'];
        const rows=this.filteredRecords.map(w=>{const r=w.record;return[r.Name||'',r.OEM__c||'',r.Vendor_Name__c||'',r.Description__c||'',r.PO_Number__c||'',r.Category__c||'',r.Currency__c||'',r.PO_Amount__c||'',r.ACV_USD__c||'',r.Last_Year_ACV_USD__c||'',r.Start_Date__c||'',r.End_Date__c||'',r.Days_To_Renewal__c||'',r.Hygiene_Status__c||''].join(',');});
        const csv=[headers.join(','),...rows].join('\n');
        const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='VendorPulse_Export_'+new Date().toISOString().slice(0,10)+'.csv';a.click();
        this.toast('Exported',`${rows.length} records exported to CSV.`,'success');
    }
    downloadTemplate(){const csv='OEM,Vendor Name,Description,PO Number,Currency,PO Amount,Category,ACV USD,Last Year ACV USD,Start Date,End Date,Duration Years,Hygiene Status\nNitro,3R Infotech Pvt. Ltd.,Nitro PDF Standard for 8 Users,1401240024,INR,108100,IT&T,1299,1250,2025-05-31,2026-05-31,1,Identified\n';const a=document.createElement('a');a.href='data:text/csv;charset=utf-8,'+encodeURIComponent(csv);a.download='VendorPulse_Import_Template.csv';a.click();}
    openCsvImporter(){ this.showCsvImporter=true; this.showImport=false; }
    handleCsvImportClose(){ this.showCsvImporter=false; }
    handleCsvImportComplete(){ this._refresh(); this.toast('Refreshed','Tracker updated with newly imported records.','success'); }
    toast(t,m,v){this.dispatchEvent(new ShowToastEvent({title:t,message:m,variant:v}));}
    // ── CALCULATOR ────────────────────────────────────────────────────────
    get splitCalcTCV() {
        // Pass TCV to calculator — prefer Estimated_PO_TCV_USD__c, fall back to PO_Amount__c
        return Number(this.splitForm?.Estimated_PO_TCV_USD__c || this.splitForm?.PO_Amount__c || 0);
    }

    openCalculator() {
        this.showCalculator = true;
    }

    handleCalcClose() {
        this.showCalculator = false;
    }

    handleCalcApply(e) {
        // Receive values from calculator and populate split year ACVs
        const { tcv, years, yearlyACVs } = e.detail;

        // Update TCV on the form if provided
        if (tcv && this.splitForm) {
            this.splitForm = Object.assign({}, this.splitForm, {
                Estimated_PO_TCV_USD__c: tcv,
                PO_Amount__c: tcv
            });
        }

        // Update years and ACVs
        if (years && yearlyACVs) {
            this.splitYearACVs = [...yearlyACVs];
        }

        // Close calculator
        this.showCalculator = false;
        this.toast('Calculator applied', 'Year values have been filled into the split modal.', 'success');
    }


}
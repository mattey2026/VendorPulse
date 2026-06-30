public with sharing class OMP_RenewalController {

    public class RenewalWrapper {
        @AuraEnabled public OMP_Renewal__c record;
        @AuraEnabled public String urgencyLevel;
        @AuraEnabled public String acvVariance;
        @AuraEnabled public Boolean isOverdue;
    }

    public class DashboardMetrics {
        @AuraEnabled public Integer totalRenewals;
        @AuraEnabled public Integer overdueCount;
        @AuraEnabled public Integer criticalCount;
        @AuraEnabled public Integer inProgressCount;
        @AuraEnabled public Integer closedYTD;
        @AuraEnabled public Decimal totalACV;
    }

    public class ImportResult {
        @AuraEnabled public Integer successCount;
        @AuraEnabled public Integer errorCount;
        @AuraEnabled public List<String> errors;
    }

    @AuraEnabled
    public static ImportResult bulkImportRenewals(List<Map<String, Object>> rows) {
        ImportResult result = new ImportResult();
        result.errors = new List<String>();
        List<OMP_Renewal__c> toInsert = new List<OMP_Renewal__c>();

        for (Integer i = 0; i < rows.size(); i++) {
            Map<String, Object> row = rows[i];
            try {
                OMP_Renewal__c rec = new OMP_Renewal__c();
                rec.OEM__c                  = (String) row.get('OEM__c');
                rec.Vendor_Name__c          = (String) row.get('Vendor_Name__c');
                rec.Description__c          = (String) row.get('Description__c');
                rec.PO_Number__c            = (String) row.get('PO_Number__c');
                rec.Category__c             = (String) row.get('Category__c');
                rec.Currency__c             = (String) row.get('Currency__c');
                rec.Hygiene_Status__c       = String.isNotBlank((String) row.get('Hygiene_Status__c'))
                                                ? (String) row.get('Hygiene_Status__c') : 'Identified';

                if (row.get('PO_Amount__c') != null && String.isNotBlank(String.valueOf(row.get('PO_Amount__c'))))
                    rec.PO_Amount__c = Decimal.valueOf(String.valueOf(row.get('PO_Amount__c')));
                if (row.get('ACV_USD__c') != null && String.isNotBlank(String.valueOf(row.get('ACV_USD__c'))))
                    rec.ACV_USD__c = Decimal.valueOf(String.valueOf(row.get('ACV_USD__c')));
                if (row.get('Last_Year_ACV_USD__c') != null && String.isNotBlank(String.valueOf(row.get('Last_Year_ACV_USD__c'))))
                    rec.Last_Year_ACV_USD__c = Decimal.valueOf(String.valueOf(row.get('Last_Year_ACV_USD__c')));
                if (row.get('Duration_Years__c') != null && String.isNotBlank(String.valueOf(row.get('Duration_Years__c'))))
                    rec.Duration_Years__c = Decimal.valueOf(String.valueOf(row.get('Duration_Years__c')));

                if (row.get('Start_Date__c') != null && String.isNotBlank(String.valueOf(row.get('Start_Date__c'))))
                    rec.Start_Date__c = Date.valueOf(String.valueOf(row.get('Start_Date__c')));
                if (row.get('End_Date__c') != null && String.isNotBlank(String.valueOf(row.get('End_Date__c')))) {
                    rec.End_Date__c = Date.valueOf(String.valueOf(row.get('End_Date__c')));
                    rec.Due_Year__c = rec.End_Date__c.year();
                }

                if (String.isBlank(rec.OEM__c) || String.isBlank(rec.Description__c)
                    || rec.Start_Date__c == null || rec.End_Date__c == null) {
                    result.errors.add('Row ' + (i + 2) + ': Missing required field (OEM, Description, Start Date, or End Date)');
                    continue;
                }
                toInsert.add(rec);
            } catch (Exception e) {
                result.errors.add('Row ' + (i + 2) + ': ' + e.getMessage());
            }
        }

        if (!toInsert.isEmpty()) {
            List<Database.SaveResult> saveResults = Database.insert(toInsert, false);
            Integer successCount = 0;
            for (Integer i = 0; i < saveResults.size(); i++) {
                if (saveResults[i].isSuccess()) {
                    successCount++;
                } else {
                    String errMsg = '';
                    for (Database.Error err : saveResults[i].getErrors()) errMsg += err.getMessage() + ' ';
                    result.errors.add('Record "' + toInsert[i].OEM__c + '": ' + errMsg);
                }
            }
            result.successCount = successCount;
        } else {
            result.successCount = 0;
        }
        result.errorCount = result.errors.size();
        return result;
    }

    @AuraEnabled
    public static OMP_Renewal__c saveRenewal(OMP_Renewal__c renewal) {
        upsert renewal;
        return renewal;
    }

    @AuraEnabled
    public static List<Id> saveAndSplit(OMP_Renewal__c baseRenewal, List<Decimal> yearlyACVs) {
        List<OMP_Renewal__c> toInsert = new List<OMP_Renewal__c>();
        Date startDate = baseRenewal.Start_Date__c;
        Integer years  = yearlyACVs.size();
        OMP_Renewal__c yr;
        for (Integer i = 0; i < years; i++) {
            yr = new OMP_Renewal__c();
            yr.OEM__c                  = baseRenewal.OEM__c;
            yr.Vendor_Name__c          = baseRenewal.Vendor_Name__c;
            yr.Description__c          = baseRenewal.Description__c + ' - Year ' + (i + 1);
            yr.PO_Number__c            = baseRenewal.PO_Number__c;
            yr.Category__c             = baseRenewal.Category__c;
            yr.Currency__c             = baseRenewal.Currency__c;
            yr.PO_Amount__c            = baseRenewal.PO_Amount__c;
            yr.Estimated_PO_TCV_USD__c = baseRenewal.Estimated_PO_TCV_USD__c;
            yr.ACV_USD__c              = yearlyACVs[i];
            yr.Last_Year_ACV_USD__c    = (i > 0) ? yearlyACVs[i - 1] : null;
            yr.Duration_Years__c       = 1;
            yr.Start_Date__c           = startDate.addYears(i);
            yr.End_Date__c             = startDate.addYears(i + 1).addDays(-1);
            yr.Due_Year__c             = yr.End_Date__c.year();
            yr.Hygiene_Status__c       = (i == 0) ? baseRenewal.Hygiene_Status__c : 'Identified';
            yr.Sourcing_Buyer__c       = baseRenewal.Sourcing_Buyer__c;
            toInsert.add(yr);
        }
        insert toInsert;
        List<Id> ids = new List<Id>();
        for (OMP_Renewal__c r : toInsert) ids.add(r.Id);
        return ids;
    }

    @AuraEnabled(cacheable=true)
    public static List<RenewalWrapper> getRenewals(String category, String hygieneStatus, String searchTerm, String buyerId) {
        String soql = 'SELECT Id, Name, OEM__c, Vendor_Name__c, Description__c, PO_Number__c, '
            + 'Currency__c, PO_Amount__c, Category__c, Estimated_PO_TCV_USD__c, '
            + 'ACV_USD__c, Last_Year_ACV_USD__c, Due_Year__c, Start_Date__c, End_Date__c, '
            + 'Days_To_Renewal__c, Duration_Years__c, Hygiene_Status__c, Closure_Date__c, '
            + 'Renewal_Quote__c, Escalation_Notes__c, Sourcing_Buyer__c '
            + 'FROM OMP_Renewal__c WHERE Hygiene_Status__c != \'Closed\'';
        List<String> filters = new List<String>();
        if (String.isNotBlank(category))      filters.add('Category__c = \'' + String.escapeSingleQuotes(category) + '\'');
        if (String.isNotBlank(hygieneStatus)) filters.add('Hygiene_Status__c = \'' + String.escapeSingleQuotes(hygieneStatus) + '\'');
        if (String.isNotBlank(buyerId))       filters.add('Sourcing_Buyer__c = \'' + String.escapeSingleQuotes(buyerId) + '\'');
        if (String.isNotBlank(searchTerm)) {
            String s = '%' + String.escapeSingleQuotes(searchTerm) + '%';
            filters.add('(OEM__c LIKE \'' + s + '\' OR Vendor_Name__c LIKE \'' + s + '\' OR PO_Number__c LIKE \'' + s + '\' OR Description__c LIKE \'' + s + '\')');
        }
        if (!filters.isEmpty()) soql += ' AND ' + String.join(filters, ' AND ');
        soql += ' ORDER BY Days_To_Renewal__c ASC NULLS LAST LIMIT 200';
        List<OMP_Renewal__c> records = Database.query(soql);
        Map<Id, User> userMap = new Map<Id, User>();
        Set<Id> buyerIds = new Set<Id>();
        for (OMP_Renewal__c r : records) { if (r.Sourcing_Buyer__c != null) buyerIds.add(r.Sourcing_Buyer__c); }
        if (!buyerIds.isEmpty()) {
            for (User u : [SELECT Id, Name, Email FROM User WHERE Id IN :buyerIds]) userMap.put(u.Id, u);
        }
        List<RenewalWrapper> result = new List<RenewalWrapper>();
        for (OMP_Renewal__c r : records) result.add(buildWrapper(r, userMap));
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static List<RenewalWrapper> getClosureLog() {
        List<OMP_Renewal__c> records = [
            SELECT Id, Name, OEM__c, Vendor_Name__c, Description__c, PO_Number__c,
                   ACV_USD__c, Last_Year_ACV_USD__c, End_Date__c, Closure_Date__c,
                   Hygiene_Status__c, Sourcing_Buyer__c, Category__c, Days_To_Renewal__c
            FROM OMP_Renewal__c
            WHERE Hygiene_Status__c = 'Closed'
            ORDER BY Closure_Date__c DESC NULLS LAST
            LIMIT 100
        ];
        Map<Id, User> um = new Map<Id, User>();
        List<RenewalWrapper> result = new List<RenewalWrapper>();
        for (OMP_Renewal__c r : records) result.add(buildWrapper(r, um));
        return result;
    }

    @AuraEnabled(cacheable=true)
    public static DashboardMetrics getDashboardMetrics() {
        DashboardMetrics m = new DashboardMetrics();
        m.totalRenewals   = [SELECT COUNT() FROM OMP_Renewal__c WHERE Hygiene_Status__c != 'Closed'];
        m.overdueCount    = [SELECT COUNT() FROM OMP_Renewal__c WHERE Days_To_Renewal__c < 0 AND Hygiene_Status__c != 'Closed'];
        m.criticalCount   = [SELECT COUNT() FROM OMP_Renewal__c WHERE Days_To_Renewal__c >= 0 AND Days_To_Renewal__c <= 30 AND Hygiene_Status__c != 'Closed'];
        m.inProgressCount = [SELECT COUNT() FROM OMP_Renewal__c WHERE Hygiene_Status__c IN ('Engaged','Approval','PR Created')];
        m.closedYTD       = [SELECT COUNT() FROM OMP_Renewal__c WHERE Hygiene_Status__c = 'Closed' AND CALENDAR_YEAR(Closure_Date__c) = :Date.today().year()];
        AggregateResult[] ar = [SELECT SUM(ACV_USD__c) total FROM OMP_Renewal__c WHERE Hygiene_Status__c != 'Closed'];
        m.totalACV = (Decimal)(ar[0].get('total') != null ? ar[0].get('total') : 0);
        return m;
    }

    @AuraEnabled
    public static String closeAndRollover(Id renewalId, Date closureDate, Decimal newACV) {
        OMP_Renewal__c rec = [SELECT Id, OEM__c, Vendor_Name__c, Description__c, Category__c, Currency__c, ACV_USD__c, Duration_Years__c, Sourcing_Buyer__c FROM OMP_Renewal__c WHERE Id = :renewalId];
        rec.Hygiene_Status__c = 'Closed';
        rec.Closure_Date__c   = closureDate;
        update rec;
        Integer duration = rec.Duration_Years__c != null ? Integer.valueOf(rec.Duration_Years__c) : 1;
        OMP_Renewal__c next = new OMP_Renewal__c(
            OEM__c               = rec.OEM__c,
            Vendor_Name__c       = rec.Vendor_Name__c,
            Description__c       = rec.Description__c,
            Category__c          = rec.Category__c,
            Currency__c          = rec.Currency__c,
            ACV_USD__c           = newACV,
            Last_Year_ACV_USD__c = rec.ACV_USD__c,
            Duration_Years__c    = rec.Duration_Years__c,
            Sourcing_Buyer__c    = rec.Sourcing_Buyer__c,
            Start_Date__c        = closureDate,
            End_Date__c          = closureDate.addYears(duration),
            Hygiene_Status__c    = 'Identified',
            Due_Year__c          = closureDate.addYears(duration).year()
        );
        insert next;
        return next.Id;
    }

    @AuraEnabled
    public static void sendEscalationEmail(String toEmail, String subject, String body) {
        Messaging.SingleEmailMessage mail = new Messaging.SingleEmailMessage();
        mail.setToAddresses(new List<String>{ toEmail });
        mail.setSubject(subject);
        mail.setPlainTextBody(body);
        mail.setSaveAsActivity(false);
        Messaging.sendEmail(new List<Messaging.SingleEmailMessage>{ mail });
    }

    private static RenewalWrapper buildWrapper(OMP_Renewal__c r, Map<Id, User> userMap) {
        RenewalWrapper w = new RenewalWrapper();
        w.record  = r;
        w.isOverdue = (r.Days_To_Renewal__c != null && r.Days_To_Renewal__c < 0);
        if      (r.Hygiene_Status__c == 'Closed')       w.urgencyLevel = 'CLOSED';
        else if (r.Days_To_Renewal__c == null)           w.urgencyLevel = 'OK';
        else if (r.Days_To_Renewal__c < 0)               w.urgencyLevel = 'OVERDUE';
        else if (r.Days_To_Renewal__c <= 14)             w.urgencyLevel = 'CRITICAL';
        else if (r.Days_To_Renewal__c <= 30)             w.urgencyLevel = 'URGENT';
        else if (r.Days_To_Renewal__c <= 90)             w.urgencyLevel = 'WARNING';
        else                                              w.urgencyLevel = 'OK';
        if (r.Last_Year_ACV_USD__c == null || r.Last_Year_ACV_USD__c == 0) {
            w.acvVariance = 'New';
        } else if (r.ACV_USD__c != null) {
            Decimal diff = r.ACV_USD__c - r.Last_Year_ACV_USD__c;
            w.acvVariance = (diff >= 0 ? '+' : '') + '$' + diff.abs().setScale(0).toPlainString();
        } else {
            w.acvVariance = '';
        }
        return w;
    }
}
